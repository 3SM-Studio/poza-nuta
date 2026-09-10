import { describe, expect, it, vi } from "vitest";

import { classifyISingImportFailure } from "@/db/ising-import-adapter";
import { loadImportWorkerProcessOptions } from "@/server/platform-admin/import-worker-process";
import {
  runImportWorker,
  runImportWorkerCycle,
  type ImportWorkerRuntimeDependencies,
  type ImportWorkerRuntimeServices,
} from "@/server/platform-admin/import-worker-runtime-core";

const claim = {
  id: 42,
  source: "ising" as const,
  mode: "write" as const,
  attemptCount: 1,
  claimToken: "00000000-0000-4000-8000-000000000042",
  leaseExpiresAt: new Date("2026-07-16T12:01:00Z"),
  progress: {
    totalCount: 0,
    processedCount: 0,
    importedCount: 0,
    skippedCount: 0,
    errorCount: 0,
  },
};

const summary = {
  processed: 2,
  inserted: 1,
  updated: 0,
  skipped: 1,
  errors: 0,
  pages: 1,
  mode: "write" as const,
};

describe("import worker runtime", () => {
  it("treats an empty --once cycle as a successful idle result", async () => {
    const harness = runtimeHarness({ claim: null });
    await expect(
      runImportWorker(
        { once: true, pollingIntervalMs: 100, pollingJitterMs: 0 },
        harness.dependencies,
      ),
    ).resolves.toBe("idle");
    expect(harness.services.assertWorkerIdentity).toHaveBeenCalledTimes(2);
    expect(harness.services.recoverExpiredImportJobs).toHaveBeenCalledOnce();
    expect(harness.services.claimNextImportJob).toHaveBeenCalledOnce();
    expect(harness.wait).not.toHaveBeenCalled();
  });

  it("checkpoints, persists monotonic progress and completes one iSing claim", async () => {
    const harness = runtimeHarness({
      execute: async ({ checkpoint }) => {
        await checkpoint("before_batch", { ...summary, processed: 0, inserted: 0, skipped: 0 });
        await checkpoint("after_batch", summary);
        return { status: "completed", summary };
      },
    });

    await expect(runImportWorkerCycle(harness.dependencies)).resolves.toBe(
      "succeeded",
    );
    expect(harness.services.checkpointImportJob).toHaveBeenCalledTimes(2);
    expect(harness.services.updateImportJobProgress).toHaveBeenCalledWith({
      importJobId: claim.id,
      claimToken: claim.claimToken,
      totalCount: 2,
      processedCount: 2,
      importedCount: 1,
      skippedCount: 1,
      errorCount: 0,
    });
    expect(harness.services.completeImportJob).toHaveBeenCalledOnce();
  });

  it("acknowledges cancellation without a completion or failure write", async () => {
    const harness = runtimeHarness({
      checkpoint: "cancelled",
      execute: async ({ checkpoint }) => {
        const decision = await checkpoint("before_page", summary);
        return {
          status: decision === "continue" ? "completed" : decision,
          summary,
        };
      },
    });

    await expect(runImportWorkerCycle(harness.dependencies)).resolves.toBe(
      "cancelled",
    );
    expect(harness.services.completeImportJob).not.toHaveBeenCalled();
    expect(harness.services.failImportJob).not.toHaveBeenCalled();
  });

  it("leaves transient failures claim-bound for lease recovery", async () => {
    const secret = "test-only-secret";
    const harness = runtimeHarness({
      execute: async () => {
        throw new TypeError(`network failed with ${secret}`);
      },
    });

    await expect(runImportWorkerCycle(harness.dependencies)).resolves.toBe(
      "retry_pending",
    );
    expect(harness.services.completeImportJob).not.toHaveBeenCalled();
    expect(harness.services.failImportJob).not.toHaveBeenCalled();
  });

  it("leaves infrastructure failures claim-bound for lease recovery", async () => {
    const harness = runtimeHarness({
      execute: async () => {
        throw Object.assign(new Error("database connection detail"), {
          code: "08006",
        });
      },
    });

    await expect(runImportWorkerCycle(harness.dependencies)).resolves.toBe(
      "retry_pending",
    );
    expect(harness.services.completeImportJob).not.toHaveBeenCalled();
    expect(harness.services.failImportJob).not.toHaveBeenCalled();
  });

  it("does not regress persisted counters while a retry catches up", async () => {
    const retryClaim = {
      ...claim,
      attemptCount: 2,
      progress: {
        totalCount: 2,
        processedCount: 2,
        importedCount: 2,
        skippedCount: 0,
        errorCount: 0,
      },
    };
    const caughtUpSummary = { ...summary, inserted: 2, skipped: 0 };
    const harness = runtimeHarness({
      claim: retryClaim,
      execute: async ({ checkpoint }) => {
        await checkpoint("after_batch", {
          ...caughtUpSummary,
          processed: 1,
          inserted: 1,
        });
        await checkpoint("after_batch", caughtUpSummary);
        return { status: "completed", summary: caughtUpSummary };
      },
    });

    await expect(runImportWorkerCycle(harness.dependencies)).resolves.toBe(
      "succeeded",
    );
    expect(harness.services.updateImportJobProgress).toHaveBeenCalledOnce();
    expect(harness.services.updateImportJobProgress).toHaveBeenCalledWith(
      expect.objectContaining({ processedCount: 2, importedCount: 2 }),
    );
  });

  it("leaves the claim running when required completion audit is unavailable", async () => {
    const harness = runtimeHarness({
      completeError: Object.assign(new Error("audit unavailable"), {
        code: "PLATFORM_AUDIT_FAILED",
      }),
    });
    await expect(runImportWorkerCycle(harness.dependencies)).resolves.toBe(
      "retry_pending",
    );
    expect(harness.services.failImportJob).not.toHaveBeenCalled();
  });

  it("stores only a constant safe terminal failure", async () => {
    const secret = "test-only-secret";
    const harness = runtimeHarness({
      execute: async () => {
        throw new Error(`invalid source payload with ${secret}`);
      },
    });

    await expect(runImportWorkerCycle(harness.dependencies)).resolves.toBe(
      "failed",
    );
    expect(harness.services.failImportJob).toHaveBeenCalledWith({
      importJobId: claim.id,
      claimToken: claim.claimToken,
      safeErrorCode: "ISING_IMPORT_FAILED",
      safeErrorSummary: "The iSing import failed safe validation.",
    });
    expect(
      JSON.stringify(harness.services.failImportJob.mock.calls),
    ).not.toContain(secret);
  });

  it("does not finalize after a claim-lost checkpoint", async () => {
    const claimLost = Object.assign(new Error("lost"), {
      code: "IMPORT_JOB_CLAIM_LOST",
    });
    const harness = runtimeHarness({
      checkpointError: claimLost,
      execute: async ({ checkpoint }) => {
        await checkpoint("before_page", summary);
        return { status: "completed", summary };
      },
    });

    await expect(runImportWorkerCycle(harness.dependencies)).resolves.toBe(
      "claim_lost",
    );
    expect(harness.services.completeImportJob).not.toHaveBeenCalled();
    expect(harness.services.failImportJob).not.toHaveBeenCalled();
  });

  it("stops polling without taking another claim after shutdown", async () => {
    let stopping = false;
    const harness = runtimeHarness({ claim: null, isStopping: () => stopping });
    harness.dependencies.wait = vi.fn(async () => {
      stopping = true;
    });

    await expect(
      runImportWorker(
        { once: false, pollingIntervalMs: 100, pollingJitterMs: 10 },
        harness.dependencies,
      ),
    ).resolves.toBe("stopped");
    expect(harness.services.claimNextImportJob).toHaveBeenCalledOnce();
  });

  it("records the bounded batch before graceful shutdown", async () => {
    let stopping = false;
    const harness = runtimeHarness({
      isStopping: () => stopping,
      execute: async ({ checkpoint }) => {
        await checkpoint("before_batch", {
          ...summary,
          processed: 0,
          inserted: 0,
          skipped: 0,
        });
        stopping = true;
        const decision = await checkpoint("after_batch", summary);
        return { status: decision === "continue" ? "completed" : decision, summary };
      },
    });

    await expect(runImportWorkerCycle(harness.dependencies)).resolves.toBe(
      "stopped",
    );
    expect(harness.services.updateImportJobProgress).toHaveBeenCalledOnce();
    expect(harness.services.completeImportJob).not.toHaveBeenCalled();
  });

  it("requires the dedicated worker URL and never falls back to DATABASE_URL", () => {
    expect(() =>
      loadImportWorkerProcessOptions(
        { NODE_ENV: "test", DATABASE_URL: "postgres://must-not-be-used" },
        ["--once"],
      ),
    ).toThrow("IMPORT_WORKER_DATABASE_URL is not configured");

    expect(
      loadImportWorkerProcessOptions(
        {
          NODE_ENV: "test",
          IMPORT_WORKER_DATABASE_URL: "postgres://worker-only",
          ISING_CLIENT_ID: "test-client",
        },
        ["--once"],
      ).once,
    ).toBe(true);
  });

  it("validates iSing configuration before the worker can start", () => {
    expect(() =>
      loadImportWorkerProcessOptions(
        {
          NODE_ENV: "test",
          IMPORT_WORKER_DATABASE_URL: "postgres://worker-only",
        },
        ["--once"],
      ),
    ).toThrow("ISING_CLIENT_ID is not configured");

    expect(() =>
      loadImportWorkerProcessOptions(
        {
          NODE_ENV: "test",
          IMPORT_WORKER_DATABASE_URL: "postgres://worker-only",
          ISING_CLIENT_ID: "test-client",
          ISING_API_BASE_URL: "not-a-url",
        },
        ["--once"],
      ),
    ).toThrow("iSing adapter configuration is invalid");
  });

  it("allows a bounded limit only for a controlled --once run", () => {
    const env = {
      NODE_ENV: "test",
      IMPORT_WORKER_DATABASE_URL: "postgres://worker-only",
      ISING_CLIENT_ID: "test-client",
      ISING_IMPORT_LIMIT: "1",
    } satisfies NodeJS.ProcessEnv;

    expect(() => loadImportWorkerProcessOptions(env, [])).toThrow(
      "ISING_IMPORT_LIMIT is allowed only for a controlled --once worker run",
    );
    expect(loadImportWorkerProcessOptions(env, ["--once"]).isingOptions.limit).toBe(
      1,
    );
  });
});

function runtimeHarness(options: {
  claim?: typeof claim | null;
  checkpoint?: "continue" | "cancelled";
  checkpointError?: Error;
  execute?: ImportWorkerRuntimeDependencies["executeISing"];
  isStopping?: () => boolean;
  completeError?: Error;
} = {}) {
  const services = {
    assertWorkerIdentity: vi.fn(async () => undefined),
    recoverExpiredImportJobs: vi.fn(async () => 0),
    claimNextImportJob: vi.fn(async () =>
      options.claim === undefined ? claim : options.claim,
    ),
    checkpointImportJob: vi.fn(async () => {
      if (options.checkpointError) throw options.checkpointError;
      return options.checkpoint ?? "continue";
    }),
    updateImportJobProgress: vi.fn(async () => undefined),
    completeImportJob: vi.fn(async () => {
      if (options.completeError) throw options.completeError;
      return "succeeded" as const;
    }),
    failImportJob: vi.fn(async () => undefined),
  } satisfies ImportWorkerRuntimeServices;
  const wait = vi.fn(async () => undefined);
  const dependencies: ImportWorkerRuntimeDependencies = {
    services,
    executeISing:
      options.execute ?? (async () => ({ status: "completed", summary })),
    classifyISingFailure: classifyISingImportFailure,
    isStopping: options.isStopping ?? (() => false),
    wait,
    random: () => 0.5,
  };
  return { dependencies, services, wait };
}
