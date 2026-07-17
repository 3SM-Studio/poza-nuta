import { OperatorApiError } from "../operator-api/errors.ts";
import {
  createSystemPlatformAuditRecord,
  PlatformAuditValidationError,
  type PlatformAuditRecord,
} from "./audit-core.ts";
import type { ImportJobMode, ImportSource } from "./import-job-core.ts";

export type ImportJobProgress = {
  totalCount: number;
  processedCount: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
};

export type ImportJobClaim = {
  id: number;
  source: ImportSource;
  mode: ImportJobMode;
  attemptCount: number;
  claimToken: string;
  leaseExpiresAt: Date;
  progress: ImportJobProgress;
};

export type ClaimBoundInput = {
  importJobId: number;
  claimToken: string;
};

export type UpdateImportJobProgressInput = ClaimBoundInput &
  ImportJobProgress;

export type CompleteImportJobInput = ClaimBoundInput & ImportJobProgress;

export type FailImportJobInput = ClaimBoundInput & {
  safeErrorCode: string;
  safeErrorSummary: string;
};

export type ImportWorkerTransactionStore = {
  claimNext(
    claimToken: string,
    supportedSources: readonly ImportSource[],
  ): Promise<ImportJobClaim | null>;
  checkpoint(
    input: ClaimBoundInput,
  ): Promise<"continue" | "cancelled" | "claim_lost">;
  heartbeat(input: ClaimBoundInput): Promise<boolean>;
  updateProgress(
    input: UpdateImportJobProgressInput,
  ): Promise<"updated" | "claim_lost" | "regression">;
  complete(
    input: CompleteImportJobInput,
  ): Promise<"succeeded" | "cancelled" | "claim_lost" | "invalid_progress">;
  fail(input: FailImportJobInput): Promise<boolean>;
  recoverExpiredExhausted(limit: number): Promise<number[]>;
  insertDiagnostic(
    importJobId: number,
    code: string,
    safeSummary: string,
  ): Promise<void>;
  insertAuditRecord(record: PlatformAuditRecord): Promise<void>;
};

export type ImportWorkerDependencies = {
  runTransaction<T>(
    callback: (store: ImportWorkerTransactionStore) => Promise<T>,
  ): Promise<T>;
  randomClaimToken(): string;
  waitBeforeRetry(milliseconds: number): Promise<void>;
  retryDelayMilliseconds(completedAttempts: number): number;
};

export const exhaustedImportErrorCode = "IMPORT_ATTEMPTS_EXHAUSTED";
export const exhaustedImportErrorSummary =
  "The import stopped after the maximum number of processing attempts.";

const retryableSqlStates = new Set(["40001", "40P01"]);
const maximumTransactionAttempts = 3;
const maximumRetryDelayMilliseconds = 100;
const safeCodePattern = /^[A-Z0-9][A-Z0-9_.-]{0,99}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function claimNextImportJob(
  dependencies: ImportWorkerDependencies,
  supportedSources: readonly ImportSource[] = ["ising", "karafun"],
): Promise<ImportJobClaim | null> {
  const claimToken = dependencies.randomClaimToken();
  validateClaimToken(claimToken);
  validateSupportedSources(supportedSources);
  return runWorkerTransaction(dependencies, (store) =>
    store.claimNext(claimToken, supportedSources),
  );
}

export async function heartbeatImportJob(
  input: ClaimBoundInput,
  dependencies: ImportWorkerDependencies,
): Promise<void> {
  validateClaimBoundInput(input);
  const written = await runWorkerTransaction(dependencies, (store) =>
    store.heartbeat(input),
  );
  if (!written) throw claimLostError();
}

export async function checkpointImportJob(
  input: ClaimBoundInput,
  dependencies: ImportWorkerDependencies,
): Promise<"continue" | "cancelled"> {
  validateClaimBoundInput(input);
  const outcome = await runWorkerTransaction(dependencies, (store) =>
    store.checkpoint(input),
  );
  if (outcome === "claim_lost") throw claimLostError();
  return outcome;
}

export async function updateImportJobProgress(
  input: UpdateImportJobProgressInput,
  dependencies: ImportWorkerDependencies,
): Promise<void> {
  validateClaimBoundInput(input);
  validateProgress(input);
  const outcome = await runWorkerTransaction(dependencies, (store) =>
    store.updateProgress(input),
  );
  if (outcome === "claim_lost") throw claimLostError();
  if (outcome === "regression") {
    throw new OperatorApiError(
      409,
      "IMPORT_JOB_PROGRESS_REGRESSION",
      "Import job progress cannot move backwards.",
    );
  }
}

export async function completeImportJob(
  input: CompleteImportJobInput,
  dependencies: ImportWorkerDependencies,
): Promise<"succeeded" | "cancelled"> {
  validateClaimBoundInput(input);
  validateProgress(input);
  return runWorkerTransaction(dependencies, async (store) => {
    const outcome = await store.complete(input);
    if (outcome === "claim_lost") throw claimLostError();
    if (outcome === "invalid_progress") throw invalidProgressError();
    if (outcome === "succeeded") {
      await insertRequiredSystemAudit(
        store,
        createSystemPlatformAuditRecord({
          action: "import.complete",
          targetType: "import_job",
          targetId: String(input.importJobId),
          outcome: "success",
          summary: "Import job completed.",
          metadata: progressMetadata(input),
        }),
      );
    }
    return outcome;
  });
}

export async function failImportJob(
  input: FailImportJobInput,
  dependencies: ImportWorkerDependencies,
): Promise<void> {
  validateClaimBoundInput(input);
  const failure = validateSafeFailure(input.safeErrorCode, input.safeErrorSummary);
  await runWorkerTransaction(dependencies, async (store) => {
    if (!(await store.fail({ ...input, ...failure }))) throw claimLostError();
    await store.insertDiagnostic(
      input.importJobId,
      failure.safeErrorCode,
      failure.safeErrorSummary,
    );
    await insertRequiredSystemAudit(
      store,
      createFailureAuditRecord(input.importJobId, failure),
    );
  });
}

export async function recoverExpiredImportJobs(
  dependencies: ImportWorkerDependencies,
  limit = 100,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw invalidWorkerInputError();
  }
  return runWorkerTransaction(dependencies, async (store) => {
    const recoveredIds = await store.recoverExpiredExhausted(limit);
    const failure = {
      safeErrorCode: exhaustedImportErrorCode,
      safeErrorSummary: exhaustedImportErrorSummary,
    };
    for (const id of recoveredIds) {
      await store.insertDiagnostic(id, failure.safeErrorCode, failure.safeErrorSummary);
      await insertRequiredSystemAudit(store, createFailureAuditRecord(id, failure));
    }
    return recoveredIds.length;
  });
}

async function runWorkerTransaction<T>(
  dependencies: ImportWorkerDependencies,
  callback: (store: ImportWorkerTransactionStore) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= maximumTransactionAttempts; attempt += 1) {
    try {
      return await dependencies.runTransaction(callback);
    } catch (error) {
      if (!isRetryableDatabaseError(error)) throw error;
      if (attempt === maximumTransactionAttempts) {
        throw new OperatorApiError(
          409,
          "IMPORT_WORKER_RETRY_EXHAUSTED",
          "The import worker transaction conflicted with another operation.",
        );
      }
      await dependencies.waitBeforeRetry(
        boundRetryDelay(dependencies.retryDelayMilliseconds(attempt)),
      );
    }
  }
  throw new Error("Import worker retry loop ended unexpectedly.");
}

async function insertRequiredSystemAudit(
  store: ImportWorkerTransactionStore,
  record: PlatformAuditRecord,
): Promise<void> {
  try {
    await store.insertAuditRecord(record);
  } catch (error) {
    if (isRetryableDatabaseError(error)) throw error;
    throw new OperatorApiError(
      503,
      "PLATFORM_AUDIT_FAILED",
      "The required audit record could not be written.",
    );
  }
}

function createFailureAuditRecord(
  importJobId: number,
  failure: { safeErrorCode: string; safeErrorSummary: string },
) {
  return createSystemPlatformAuditRecord({
    action: "import.fail",
    targetType: "import_job",
    targetId: String(importJobId),
    outcome: "failure",
    summary: "Import job failed safely.",
    reason: failure.safeErrorSummary,
    metadata: { code: failure.safeErrorCode },
  });
}

function validateSafeFailure(code: string, summary: string) {
  if (typeof code !== "string" || !safeCodePattern.test(code)) {
    throw invalidWorkerInputError();
  }
  if (typeof summary !== "string") throw invalidWorkerInputError();
  const normalizedSummary = summary.trim();
  if (normalizedSummary.length === 0 || normalizedSummary.length > 500) {
    throw invalidWorkerInputError();
  }
  try {
    createFailureAuditRecord(1, {
      safeErrorCode: code,
      safeErrorSummary: normalizedSummary,
    });
  } catch (error) {
    if (error instanceof PlatformAuditValidationError) {
      throw invalidWorkerInputError();
    }
    throw error;
  }
  return { safeErrorCode: code, safeErrorSummary: normalizedSummary };
}

function validateProgress(progress: ImportJobProgress): void {
  const values = [
    progress.totalCount,
    progress.processedCount,
    progress.importedCount,
    progress.skippedCount,
    progress.errorCount,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw invalidProgressError();
  }
  if (
    progress.processedCount !==
      progress.importedCount + progress.skippedCount + progress.errorCount ||
    (progress.totalCount !== 0 && progress.processedCount > progress.totalCount)
  ) {
    throw invalidProgressError();
  }
}

function validateClaimBoundInput(input: ClaimBoundInput): void {
  if (!Number.isSafeInteger(input.importJobId) || input.importJobId <= 0) {
    throw invalidWorkerInputError();
  }
  validateClaimToken(input.claimToken);
}

function validateClaimToken(value: string): void {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw invalidWorkerInputError();
  }
}

function validateSupportedSources(
  sources: readonly ImportSource[],
): void {
  if (
    sources.length === 0 ||
    new Set(sources).size !== sources.length ||
    sources.some((source) => source !== "ising" && source !== "karafun")
  ) {
    throw invalidWorkerInputError();
  }
}

function progressMetadata(progress: ImportJobProgress) {
  return {
    totalCount: progress.totalCount,
    processedCount: progress.processedCount,
    importedCount: progress.importedCount,
    skippedCount: progress.skippedCount,
    errorCount: progress.errorCount,
  };
}

function invalidWorkerInputError() {
  return new OperatorApiError(
    400,
    "INVALID_IMPORT_WORKER_INPUT",
    "Import worker input is invalid.",
  );
}

function invalidProgressError() {
  return new OperatorApiError(
    400,
    "INVALID_IMPORT_JOB_PROGRESS",
    "Import job progress is invalid.",
  );
}

function claimLostError() {
  return new OperatorApiError(
    409,
    "IMPORT_JOB_CLAIM_LOST",
    "The import job claim is no longer valid.",
  );
}

function isRetryableDatabaseError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return false;
    const record = current as Record<string, unknown>;
    if (typeof record.code === "string" && retryableSqlStates.has(record.code)) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

function boundRetryDelay(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximumRetryDelayMilliseconds, Math.max(0, Math.floor(value)));
}
