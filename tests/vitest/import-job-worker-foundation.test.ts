import { describe, expect, it, vi } from "vitest";

import type { PlatformAuditRecord } from "@/server/platform-admin/audit-core";
import {
  enqueueImportJobWithDependencies,
  requestImportCancellationWithDependencies,
  type ImportJobMutationDependencies,
  type ImportJobTransactionStore,
} from "@/server/platform-admin/import-job-core";
import {
  claimNextImportJob,
  completeImportJob,
  failImportJob,
  heartbeatImportJob,
  recoverExpiredImportJobs,
  updateImportJobProgress,
  type ImportWorkerDependencies,
  type ImportWorkerTransactionStore,
} from "@/server/platform-admin/import-worker-core";

const actorId = 7;
const jobId = 42;
const claimToken = "00000000-0000-4000-8000-000000000042";
const progress = {
  totalCount: 3,
  processedCount: 3,
  importedCount: 2,
  skippedCount: 1,
  errorCount: 0,
};

describe("platform import job services", () => {
  it("authorizes source-specific enqueue and audits it atomically", async () => {
    const harness = platformHarness();
    const result = await enqueueImportJobWithDependencies(
      { source: "ising", mode: "write" },
      harness.dependencies,
    );

    expect(result).toMatchObject({ id: jobId, source: "ising", status: "queued" });
    expect(harness.authorizeActor).toHaveBeenCalledWith("imports.ising.start");
    expect(harness.committedAudits()).toEqual([
      expect.objectContaining({
        actorKind: "operator",
        operatorId: actorId,
        action: "import.start",
        entityId: String(jobId),
      }),
    ]);
  });

  it("does not enter a transaction when support is denied", async () => {
    const harness = platformHarness({ authorizationError: accessDenied() });
    await expect(
      enqueueImportJobWithDependencies(
        { source: "karafun", mode: "validate" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_ACCESS_DENIED" });
    expect(harness.authorizeActor).toHaveBeenCalledWith(
      "imports.karafun.execute",
    );
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  it("maps the active-source unique violation to IMPORT_JOB_ACTIVE", async () => {
    const harness = platformHarness({
      transactionErrors: [postgresError("23505", "import_jobs_one_active_per_source_idx")],
    });
    await expect(
      enqueueImportJobWithDependencies(
        { source: "ising", mode: "write" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "IMPORT_JOB_ACTIVE" });
    expect(harness.committedAudits()).toEqual([]);
  });

  it("makes repeated cancellation deterministic without duplicate audit", async () => {
    const harness = platformHarness({
      cancellationResults: [
        { id: jobId, source: "ising", status: "running", changed: true },
        { id: jobId, source: "ising", status: "running", changed: false },
      ],
    });
    await requestImportCancellationWithDependencies(
      { importJobId: jobId },
      harness.dependencies,
    );
    await requestImportCancellationWithDependencies(
      { importJobId: jobId },
      harness.dependencies,
    );
    expect(harness.authorizeActor).toHaveBeenCalledWith("imports.cancel");
    expect(harness.committedAudits()).toHaveLength(1);
    expect(harness.committedAudits()[0]).toMatchObject({ action: "import.cancel" });
  });

  it("rolls back enqueue when the required audit fails", async () => {
    const harness = platformHarness({ auditFailure: true });
    await expect(
      enqueueImportJobWithDependencies(
        { source: "ising", mode: "write" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_AUDIT_FAILED" });
    expect(harness.committedJobs()).toBe(0);
  });
});

describe("import worker transaction services", () => {
  it.each(["40001", "40P01"])(
    "claims with a generated UUID and retries full transaction error %s",
    async (sqlState) => {
      const harness = workerHarness({
        transactionErrors: [postgresError(sqlState)],
      });
      const claim = await claimNextImportJob(harness.dependencies);
      expect(claim).toMatchObject({ id: jobId, claimToken, attemptCount: 1 });
      expect(harness.runTransaction).toHaveBeenCalledTimes(2);
      expect(harness.waitBeforeRetry).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["heartbeat", () => heartbeatImportJob({ importJobId: jobId, claimToken }, workerHarness({ heartbeat: false }).dependencies)],
    ["progress", () => updateImportJobProgress({ importJobId: jobId, claimToken, ...progress }, workerHarness({ progress: "claim_lost" }).dependencies)],
    ["complete", () => completeImportJob({ importJobId: jobId, claimToken, ...progress }, workerHarness({ complete: "claim_lost" }).dependencies)],
    ["fail", () => failImportJob({ importJobId: jobId, claimToken, safeErrorCode: "IMPORT_FAILED", safeErrorSummary: "The import failed safely." }, workerHarness({ fail: false }).dependencies)],
  ])("maps lost %s ownership to IMPORT_JOB_CLAIM_LOST", async (_label, execute) => {
    await expect(execute()).rejects.toMatchObject({ code: "IMPORT_JOB_CLAIM_LOST" });
  });

  it("rejects regressing or inconsistent progress", async () => {
    const regression = workerHarness({ progress: "regression" });
    await expect(
      updateImportJobProgress(
        { importJobId: jobId, claimToken, ...progress },
        regression.dependencies,
      ),
    ).rejects.toMatchObject({ code: "IMPORT_JOB_PROGRESS_REGRESSION" });

    const invalid = workerHarness();
    await expect(
      updateImportJobProgress(
        {
          importJobId: jobId,
          claimToken,
          ...progress,
          processedCount: 2,
        },
        invalid.dependencies,
      ),
    ).rejects.toMatchObject({ code: "INVALID_IMPORT_JOB_PROGRESS" });
    expect(invalid.runTransaction).not.toHaveBeenCalled();
  });

  it("audits successful completion as system in the same transaction", async () => {
    const harness = workerHarness();
    await expect(
      completeImportJob(
        { importJobId: jobId, claimToken, ...progress },
        harness.dependencies,
      ),
    ).resolves.toBe("succeeded");
    expect(harness.committedAudits()).toEqual([
      expect.objectContaining({
        actorKind: "system",
        operatorId: null,
        action: "import.complete",
      }),
    ]);
  });

  it("does not emit completion audit for cooperative cancellation", async () => {
    const harness = workerHarness({ complete: "cancelled" });
    await expect(
      completeImportJob(
        { importJobId: jobId, claimToken, ...progress },
        harness.dependencies,
      ),
    ).resolves.toBe("cancelled");
    expect(harness.committedAudits()).toEqual([]);
  });

  it("accepts only bounded safe failure data and never an Error payload", async () => {
    const harness = workerHarness();
    await failImportJob(
      {
        importJobId: jobId,
        claimToken,
        safeErrorCode: "IMPORT_FAILED",
        safeErrorSummary: "The import failed safely.",
      },
      harness.dependencies,
    );
    expect(harness.committedDiagnostics()).toEqual([
      { importJobId: jobId, code: "IMPORT_FAILED", summary: "The import failed safely." },
    ]);
    expect(harness.committedAudits()[0]).toMatchObject({
      actorKind: "system",
      action: "import.fail",
    });

    await expect(
      failImportJob(
        {
          importJobId: jobId,
          claimToken,
          safeErrorCode: "IMPORT_FAILED",
          safeErrorSummary: "Bearer secret-value",
        },
        workerHarness().dependencies,
      ),
    ).rejects.toMatchObject({ code: "INVALID_IMPORT_WORKER_INPUT" });
  });

  it("rolls terminal mutation and diagnostic back when system audit fails", async () => {
    const harness = workerHarness({ auditFailure: true });
    await expect(
      failImportJob(
        {
          importJobId: jobId,
          claimToken,
          safeErrorCode: "IMPORT_FAILED",
          safeErrorSummary: "The import failed safely.",
        },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_AUDIT_FAILED" });
    expect(harness.committedMutations()).toBe(0);
    expect(harness.committedDiagnostics()).toEqual([]);
  });

  it("recovers only exhausted jobs with a constant safe failure", async () => {
    const harness = workerHarness({ recoveredIds: [41, 42] });
    await expect(recoverExpiredImportJobs(harness.dependencies)).resolves.toBe(2);
    expect(harness.committedDiagnostics()).toHaveLength(2);
    expect(harness.committedAudits()).toHaveLength(2);
    expect(harness.committedAudits()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorKind: "system", action: "import.fail" }),
      ]),
    );
  });
});

function platformHarness(options: {
  authorizationError?: Error;
  transactionErrors?: Error[];
  cancellationResults?: Array<{
    id: number;
    source: "ising";
    status: "running";
    changed: boolean;
  }>;
  auditFailure?: boolean;
} = {}) {
  let committedJobCount = 0;
  let committedAudits: PlatformAuditRecord[] = [];
  const transactionErrors = [...(options.transactionErrors ?? [])];
  const cancellationResults = [...(options.cancellationResults ?? [])];
  const authorizeActor = vi.fn(async () => {
    if (options.authorizationError) throw options.authorizationError;
    return { operatorId: actorId };
  });
  const runTransaction = vi.fn();
  const runTransactionWithStore: ImportJobMutationDependencies["runTransaction"] =
    async <T>(callback: (store: ImportJobTransactionStore) => Promise<T>) => {
      runTransaction();
      let localJobs = 0;
      const localAudits: PlatformAuditRecord[] = [];
      const store: ImportJobTransactionStore = {
        findActorAccess: async () => ({ role: "platform_owner" }),
        enqueue: async (_operatorId, input) => {
          localJobs += 1;
          return { id: jobId, source: input.source, status: "queued", changed: true };
        },
        requestCancellation: async () =>
          cancellationResults.shift() ?? {
            id: jobId,
            source: "ising",
            status: "running",
            changed: true,
          },
        insertAuditRecord: async (record) => {
          if (options.auditFailure) throw new Error("audit unavailable");
          localAudits.push(record);
        },
      };
      const result = await callback(store);
      const transactionError = transactionErrors.shift();
      if (transactionError) throw transactionError;
      committedJobCount += localJobs;
      committedAudits = [...committedAudits, ...localAudits];
      return result;
    };
  const dependencies: ImportJobMutationDependencies = {
    authorizeActor,
    runTransaction: runTransactionWithStore,
    waitBeforeRetry: vi.fn(async () => undefined),
    retryDelayMilliseconds: () => 0,
  };
  return {
    dependencies,
    authorizeActor,
    runTransaction,
    committedJobs: () => committedJobCount,
    committedAudits: () => committedAudits,
  };
}

function workerHarness(options: {
  transactionErrors?: Error[];
  heartbeat?: boolean;
  progress?: "updated" | "claim_lost" | "regression";
  complete?: "succeeded" | "cancelled" | "claim_lost" | "invalid_progress";
  fail?: boolean;
  recoveredIds?: number[];
  auditFailure?: boolean;
} = {}) {
  let committedMutations = 0;
  let committedAudits: PlatformAuditRecord[] = [];
  let committedDiagnostics: Array<{ importJobId: number; code: string; summary: string }> = [];
  const transactionErrors = [...(options.transactionErrors ?? [])];
  const runTransaction = vi.fn();
  const runTransactionWithStore: ImportWorkerDependencies["runTransaction"] =
    async <T>(callback: (store: ImportWorkerTransactionStore) => Promise<T>) => {
      runTransaction();
      let localMutations = 0;
      const localAudits: PlatformAuditRecord[] = [];
      const localDiagnostics: typeof committedDiagnostics = [];
      const store: ImportWorkerTransactionStore = {
        claimNext: async (token) => {
          localMutations += 1;
          return {
            id: jobId,
            source: "ising",
            mode: "write",
            attemptCount: 1,
            claimToken: token,
            leaseExpiresAt: new Date("2026-07-16T12:01:00Z"),
          };
        },
        heartbeat: async () => options.heartbeat ?? true,
        updateProgress: async () => options.progress ?? "updated",
        complete: async () => {
          localMutations += 1;
          return options.complete ?? "succeeded";
        },
        fail: async () => {
          if (options.fail === false) return false;
          localMutations += 1;
          return true;
        },
        recoverExpiredExhausted: async () => {
          const ids = options.recoveredIds ?? [];
          localMutations += ids.length;
          return ids;
        },
        insertDiagnostic: async (importJobId, code, summary) => {
          localDiagnostics.push({ importJobId, code, summary });
        },
        insertAuditRecord: async (record) => {
          if (options.auditFailure) throw new Error("audit unavailable");
          localAudits.push(record);
        },
      };
      const result = await callback(store);
      const transactionError = transactionErrors.shift();
      if (transactionError) throw transactionError;
      committedMutations += localMutations;
      committedAudits = [...committedAudits, ...localAudits];
      committedDiagnostics = [...committedDiagnostics, ...localDiagnostics];
      return result;
    };
  const waitBeforeRetry = vi.fn(async () => undefined);
  const dependencies: ImportWorkerDependencies = {
    runTransaction: runTransactionWithStore,
    randomClaimToken: () => claimToken,
    waitBeforeRetry,
    retryDelayMilliseconds: () => 0,
  };
  return {
    dependencies,
    runTransaction,
    waitBeforeRetry,
    committedMutations: () => committedMutations,
    committedAudits: () => committedAudits,
    committedDiagnostics: () => committedDiagnostics,
  };
}

function postgresError(code: string, constraintName?: string) {
  return Object.assign(new Error("database failure"), {
    code,
    ...(constraintName ? { constraint_name: constraintName } : {}),
  });
}

function accessDenied() {
  return Object.assign(new Error("denied"), {
    status: 403,
    code: "PLATFORM_ACCESS_DENIED",
  });
}
