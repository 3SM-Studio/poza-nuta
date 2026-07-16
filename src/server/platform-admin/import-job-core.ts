import { OperatorApiError } from "../operator-api/errors.ts";
import {
  createPlatformAuditRecord,
  type PlatformAuditRecord,
} from "./audit-core.ts";
import type { PlatformPermission, PlatformRole } from "./policy.ts";

export type ImportSource = "ising" | "karafun";
export type ImportJobMode = "validate" | "dry_run" | "write";

export type EnqueueImportJobInput = {
  source: ImportSource;
  mode: ImportJobMode;
};

export type RequestImportCancellationInput = {
  importJobId: number;
};

export type ImportJobMutationResult = {
  id: number;
  source: ImportSource;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  changed: boolean;
};

export type ImportJobActorAccess = { role: PlatformRole };

export type ImportJobTransactionStore = {
  findActorAccess(operatorUserId: number): Promise<ImportJobActorAccess | null>;
  enqueue(
    actorOperatorId: number,
    input: EnqueueImportJobInput,
  ): Promise<ImportJobMutationResult>;
  requestCancellation(
    actorOperatorId: number,
    input: RequestImportCancellationInput,
  ): Promise<ImportJobMutationResult | null>;
  insertAuditRecord(record: PlatformAuditRecord): Promise<void>;
};

export type ImportJobMutationDependencies = {
  authorizeActor(
    permission: PlatformPermission,
  ): Promise<{ operatorId: number }>;
  runTransaction<T>(
    callback: (store: ImportJobTransactionStore) => Promise<T>,
  ): Promise<T>;
  waitBeforeRetry(milliseconds: number): Promise<void>;
  retryDelayMilliseconds(completedAttempts: number): number;
};

const retryableSqlStates = new Set(["40001", "40P01"]);
const maximumTransactionAttempts = 3;
const maximumRetryDelayMilliseconds = 100;

export async function enqueueImportJobWithDependencies(
  input: EnqueueImportJobInput,
  dependencies: ImportJobMutationDependencies,
): Promise<ImportJobMutationResult> {
  validateEnqueueInput(input);
  const actor = await dependencies.authorizeActor(permissionForSource(input.source));
  validatePositiveId(actor.operatorId);

  return runWithRetry(dependencies, async (store) => {
    await requireActorAccess(store, actor.operatorId);
    const result = await store.enqueue(actor.operatorId, input);
    await requireActorAccess(store, actor.operatorId);
    await insertRequiredAudit(
      store,
      createPlatformAuditRecord(actor.operatorId, {
        action: "import.start",
        targetType: "import_job",
        targetId: String(result.id),
        outcome: "success",
        summary: "Import job queued.",
        metadata: { source: result.source, mode: input.mode },
      }),
    );
    return result;
  }).catch((error) => {
    if (
      databaseErrorProperty(error, "code") === "23505" &&
      databaseErrorProperty(error, "constraint_name") ===
        "import_jobs_one_active_per_source_idx"
    ) {
      throw new OperatorApiError(
        409,
        "IMPORT_JOB_ACTIVE",
        "An active import job already exists for this source.",
      );
    }
    throw mapMutationError(error);
  });
}

export async function requestImportCancellationWithDependencies(
  input: RequestImportCancellationInput,
  dependencies: ImportJobMutationDependencies,
): Promise<ImportJobMutationResult> {
  validatePositiveId(input.importJobId);
  const actor = await dependencies.authorizeActor("imports.cancel");
  validatePositiveId(actor.operatorId);

  return runWithRetry(dependencies, async (store) => {
    await requireActorAccess(store, actor.operatorId);
    const result = await store.requestCancellation(actor.operatorId, input);
    if (!result) {
      throw new OperatorApiError(
        404,
        "IMPORT_JOB_NOT_FOUND",
        "The import job was not found.",
      );
    }
    await requireActorAccess(store, actor.operatorId);
    if (result.changed) {
      await insertRequiredAudit(
        store,
        createPlatformAuditRecord(actor.operatorId, {
          action: "import.cancel",
          targetType: "import_job",
          targetId: String(result.id),
          outcome: "success",
          summary: "Import cancellation requested.",
          metadata: { source: result.source, status: result.status },
        }),
      );
    }
    return result;
  }).catch((error) => {
    throw mapMutationError(error);
  });
}

async function runWithRetry<T>(
  dependencies: ImportJobMutationDependencies,
  callback: (store: ImportJobTransactionStore) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= maximumTransactionAttempts; attempt += 1) {
    try {
      return await dependencies.runTransaction(callback);
    } catch (error) {
      if (!isRetryableDatabaseError(error)) throw error;
      if (attempt === maximumTransactionAttempts) {
        throw new OperatorApiError(
          409,
          "IMPORT_JOB_RETRY_EXHAUSTED",
          "The import job mutation conflicted with another operation.",
        );
      }
      await dependencies.waitBeforeRetry(
        boundRetryDelay(dependencies.retryDelayMilliseconds(attempt)),
      );
    }
  }
  throw new Error("Import job retry loop ended unexpectedly.");
}

async function requireActorAccess(
  store: ImportJobTransactionStore,
  operatorId: number,
): Promise<void> {
  const access = await store.findActorAccess(operatorId);
  if (access?.role !== "platform_owner" && access?.role !== "platform_admin") {
    throw accessDeniedError();
  }
}

async function insertRequiredAudit(
  store: ImportJobTransactionStore,
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

function validateEnqueueInput(input: EnqueueImportJobInput): void {
  if (
    (input.source !== "ising" && input.source !== "karafun") ||
    !["validate", "dry_run", "write"].includes(input.mode)
  ) {
    throw invalidInputError();
  }
}

function permissionForSource(source: ImportSource): PlatformPermission {
  return source === "ising" ? "imports.ising.start" : "imports.karafun.execute";
}

function mapMutationError(error: unknown): Error {
  if (error instanceof OperatorApiError) return error;
  if (isRetryableDatabaseError(error)) {
    return new OperatorApiError(
      409,
      "IMPORT_JOB_RETRY_EXHAUSTED",
      "The import job mutation conflicted with another operation.",
    );
  }
  return new OperatorApiError(
    503,
    "IMPORT_JOB_MUTATION_FAILED",
    "The import job mutation could not be completed.",
  );
}

function validatePositiveId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidInputError();
}

function invalidInputError() {
  return new OperatorApiError(
    400,
    "INVALID_IMPORT_JOB_INPUT",
    "Import job input is invalid.",
  );
}

function accessDeniedError() {
  return new OperatorApiError(
    403,
    "PLATFORM_ACCESS_DENIED",
    "Platform access is not permitted.",
  );
}

function isRetryableDatabaseError(error: unknown): boolean {
  return retryableSqlStates.has(databaseErrorProperty(error, "code") ?? "");
}

function databaseErrorProperty(
  error: unknown,
  property: "code" | "constraint_name",
): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return undefined;
    const record = current as Record<string, unknown>;
    if (typeof record[property] === "string") return record[property];
    current = record.cause;
  }
  return undefined;
}

function boundRetryDelay(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximumRetryDelayMilliseconds, Math.max(0, Math.floor(value)));
}
