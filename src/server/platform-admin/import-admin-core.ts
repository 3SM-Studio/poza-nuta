import { OperatorApiError } from "../operator-api/errors.ts";
import type { ImportJobMutationResult } from "./import-job-core.ts";
import { hasPlatformPermission, type PlatformRole } from "./policy.ts";

export const importJobListLimit = 50;
export const activeImportRefreshMilliseconds = 5_000;

export type ImportJobSafeRow = {
  id: number;
  source: "ising" | "karafun";
  mode: "validate" | "dry_run" | "write";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  initiatorKind: "operator" | "system" | "legacy";
  createdAt: Date;
  startedAt: Date | null;
  terminalAt: Date | null;
  totalCount: number | null;
  processedCount: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number | null;
  safeErrorCode: string | null;
  safeErrorSummary: string | null;
  cancellationRequestedAt: Date | null;
};

export type ImportJobViewModel = Omit<
  ImportJobSafeRow,
  "createdAt" | "startedAt" | "terminalAt" | "cancellationRequestedAt"
> & {
  createdAt: string;
  startedAt: string | null;
  terminalAt: string | null;
  cancellationRequestedAt: string | null;
  cancellationRequested: boolean;
};

export type ImportAdminCapabilities = {
  canStartISing: boolean;
  canCancel: boolean;
};

export type ImportAdminPageData = {
  jobs: ImportJobViewModel[];
  capabilities: ImportAdminCapabilities;
};

type ImportAdminPageSession = {
  platformMembership: { role: PlatformRole };
};

type ImportAdminPageDependencies = {
  requireAccess: () => Promise<ImportAdminPageSession>;
  readRecentJobs: (limit: number) => Promise<ImportJobSafeRow[]>;
};

export type ImportAdminActionResult = {
  kind: "success" | "info" | "error";
  message: string;
};

type ImportAdminMutationDependencies = {
  enqueue: (input: {
    source: "ising";
    mode: "dry_run" | "write";
  }) => Promise<ImportJobMutationResult>;
  requestCancellation: (input: {
    importJobId: number;
  }) => Promise<ImportJobMutationResult>;
};

export type ImportJobProgress =
  | { kind: "unknown"; processedCount: number }
  | { kind: "determinate"; processedCount: number; totalCount: number; percent: number };

export async function loadImportAdminPageWithDependencies(
  dependencies: ImportAdminPageDependencies,
): Promise<ImportAdminPageData> {
  const session = await dependencies.requireAccess();
  const rows = await dependencies.readRecentJobs(importJobListLimit);

  return {
    jobs: rows.map(createImportJobViewModel),
    capabilities: getImportAdminCapabilities(session.platformMembership.role),
  };
}

export function createImportJobViewModel(
  row: ImportJobSafeRow,
): ImportJobViewModel {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    terminalAt: row.terminalAt?.toISOString() ?? null,
    cancellationRequestedAt:
      row.cancellationRequestedAt?.toISOString() ?? null,
    cancellationRequested: row.cancellationRequestedAt !== null,
  };
}

export function getImportAdminCapabilities(
  role: PlatformRole,
): ImportAdminCapabilities {
  return {
    canStartISing: hasPlatformPermission(role, "imports.ising.start"),
    canCancel: hasPlatformPermission(role, "imports.cancel"),
  };
}

export function getImportJobProgress(
  totalCount: number | null,
  processedCount: number,
): ImportJobProgress {
  if (totalCount === null || totalCount <= 0) {
    return { kind: "unknown", processedCount: Math.max(0, processedCount) };
  }

  const boundedProcessed = Math.min(totalCount, Math.max(0, processedCount));
  return {
    kind: "determinate",
    processedCount: boundedProcessed,
    totalCount,
    percent: Math.round((boundedProcessed / totalCount) * 100),
  };
}

export function hasActiveImportJob(jobs: ImportJobViewModel[]) {
  return jobs.some((job) => job.status === "queued" || job.status === "running");
}

export async function startISingImportWithDependencies(
  mode: "dry_run" | "write",
  dependencies: ImportAdminMutationDependencies,
): Promise<ImportAdminActionResult> {
  try {
    await dependencies.enqueue({ source: "ising", mode });
    return {
      kind: "success",
      message:
        mode === "dry_run"
          ? "Sprawdzenie iSing zostało dodane do kolejki."
          : "Import iSing został dodany do kolejki.",
    };
  } catch (error) {
    return mapImportAdminActionError(error);
  }
}

export async function cancelImportJobWithDependencies(
  importJobId: number,
  dependencies: ImportAdminMutationDependencies,
): Promise<ImportAdminActionResult> {
  try {
    const result = await dependencies.requestCancellation({ importJobId });
    if (!result.changed) {
      return {
        kind: "info",
        message: "Job nie wymaga kolejnego żądania anulowania.",
      };
    }

    return {
      kind: "success",
      message:
        result.status === "cancelled"
          ? "Job oczekujący został anulowany."
          : "Żądanie anulowania zostało zapisane.",
    };
  } catch (error) {
    return mapImportAdminActionError(error);
  }
}

export function mapImportAdminActionError(
  error: unknown,
): ImportAdminActionResult {
  if (error instanceof OperatorApiError) {
    const messages: Partial<Record<string, string>> = {
      IMPORT_JOB_ACTIVE: "Import iSing jest już aktywny.",
      IMPORT_JOB_NOT_FOUND: "Job importu nie jest już dostępny.",
      INVALID_IMPORT_JOB_INPUT: "Nieprawidłowe żądanie importu.",
      PLATFORM_ACCESS_DENIED: "Nie masz uprawnień do tej operacji.",
    };

    const message = messages[error.code];
    if (message) return { kind: "error", message };
  }

  return {
    kind: "error",
    message: "Nie udało się wykonać operacji. Spróbuj ponownie.",
  };
}
