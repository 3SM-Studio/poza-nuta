import { describe, expect, it, vi } from "vitest";

import { OperatorApiError } from "@/server/operator-api/errors";
import {
  cancelImportJobWithDependencies,
  createImportJobViewModel,
  getImportAdminCapabilities,
  getImportJobProgress,
  hasActiveImportJob,
  importJobListLimit,
  loadImportAdminPageWithDependencies,
  mapImportAdminActionError,
  startISingImportWithDependencies,
  type ImportJobSafeRow,
} from "@/server/platform-admin/import-admin-core";

const safeRow: ImportJobSafeRow = {
  id: 21,
  source: "ising",
  mode: "dry_run",
  status: "running",
  initiatorKind: "operator",
  createdAt: new Date("2026-07-17T10:00:00Z"),
  startedAt: new Date("2026-07-17T10:01:00Z"),
  terminalAt: null,
  totalCount: 20,
  processedCount: 5,
  importedCount: 4,
  skippedCount: 1,
  errorCount: 0,
  safeErrorCode: null,
  safeErrorSummary: null,
  cancellationRequestedAt: null,
};

describe("platform admin imports read model", () => {
  it.each(["platform_owner", "platform_admin"] as const)(
    "allows %s to operate iSing jobs",
    (role) => {
      expect(getImportAdminCapabilities(role)).toEqual({
        canStartISing: true,
        canCancel: true,
      });
    },
  );

  it("lets support read the list without mutation capabilities", async () => {
    const readRecentJobs = vi.fn(async () => [safeRow]);
    const result = await loadImportAdminPageWithDependencies({
      requireAccess: async () => ({
        platformMembership: { role: "support" },
      }),
      readRecentJobs,
    });

    expect(readRecentJobs).toHaveBeenCalledWith(importJobListLimit);
    expect(result.capabilities).toEqual({
      canStartISing: false,
      canCancel: false,
    });
    expect(result.jobs).toHaveLength(1);
  });

  it("does not read jobs when platform access is denied", async () => {
    const readRecentJobs = vi.fn(async () => [safeRow]);
    await expect(
      loadImportAdminPageWithDependencies({
        requireAccess: async () => {
          throw new OperatorApiError(
            403,
            "PLATFORM_ACCESS_DENIED",
            "Platform access is not permitted.",
          );
        },
        readRecentJobs,
      }),
    ).rejects.toMatchObject({ code: "PLATFORM_ACCESS_DENIED" });
    expect(readRecentJobs).not.toHaveBeenCalled();
  });

  it("exposes only the safe job view contract", () => {
    const view = createImportJobViewModel(safeRow);

    expect(Object.keys(view).sort()).toEqual([
      "cancellationRequested",
      "cancellationRequestedAt",
      "createdAt",
      "errorCount",
      "id",
      "importedCount",
      "initiatorKind",
      "mode",
      "processedCount",
      "safeErrorCode",
      "safeErrorSummary",
      "skippedCount",
      "source",
      "startedAt",
      "status",
      "terminalAt",
      "totalCount",
    ]);
    expect(JSON.stringify(view)).not.toMatch(
      /claimToken|leaseExpiresAt|heartbeatAt|rawError|connection|databaseUrl/i,
    );
  });

  it("does not invent percentages for zero or unknown totals", () => {
    expect(getImportJobProgress(0, 3)).toEqual({
      kind: "unknown",
      processedCount: 3,
    });
    expect(getImportJobProgress(null, 3)).toEqual({
      kind: "unknown",
      processedCount: 3,
    });
    expect(getImportJobProgress(10, 4)).toEqual({
      kind: "determinate",
      processedCount: 4,
      totalCount: 10,
      percent: 40,
    });
  });

  it("detects only queued and running jobs as active", () => {
    const running = createImportJobViewModel(safeRow);
    const succeeded = { ...running, status: "succeeded" as const };
    expect(hasActiveImportJob([running])).toBe(true);
    expect(hasActiveImportJob([succeeded])).toBe(false);
  });
});

describe("platform admin import actions", () => {
  it.each(["dry_run", "write"] as const)(
    "enqueues fixed server-side iSing mode %s without client actor data",
    async (mode) => {
      const enqueue = vi.fn(
        async (_input: { source: "ising"; mode: "dry_run" | "write" }) => ({
          id: 31,
          source: "ising" as const,
          status: "queued" as const,
          changed: true,
        }),
      );

      await expect(
        startISingImportWithDependencies(mode, {
          enqueue,
          requestCancellation: vi.fn(),
        }),
      ).resolves.toMatchObject({ kind: "success" });
      expect(enqueue).toHaveBeenCalledWith({ source: "ising", mode });
      expect(Object.keys(enqueue.mock.calls[0]?.[0] ?? {})).toEqual([
        "source",
        "mode",
      ]);
    },
  );

  it("maps active-source conflicts without leaking the constraint", async () => {
    const result = await startISingImportWithDependencies("write", {
      enqueue: async () => {
        throw new OperatorApiError(
          409,
          "IMPORT_JOB_ACTIVE",
          "import_jobs_one_active_per_source_idx",
        );
      },
      requestCancellation: vi.fn(),
    });

    expect(result).toEqual({
      kind: "error",
      message: "Import iSing jest już aktywny.",
    });
    expect(JSON.stringify(result)).not.toMatch(/index|constraint|one_active/i);
  });

  it.each([
    ["cancelled", "Job oczekujący został anulowany."],
    ["running", "Żądanie anulowania zostało zapisane."],
  ] as const)("handles %s cancellation", async (status, message) => {
    const result = await cancelImportJobWithDependencies(31, {
      enqueue: vi.fn(),
      requestCancellation: async () => ({
        id: 31,
        source: "ising",
        status,
        changed: true,
      }),
    });

    expect(result).toEqual({ kind: "success", message });
  });

  it("never returns raw errors or secrets to the panel", () => {
    const result = mapImportAdminActionError(
      new Error("Bearer secret-value at DATABASE_URL"),
    );
    expect(result).toEqual({
      kind: "error",
      message: "Nie udało się wykonać operacji. Spróbuj ponownie.",
    });
    expect(JSON.stringify(result)).not.toMatch(/secret-value|database_url/i);
  });
});
