import { inArray, sql } from "drizzle-orm";

import {
  importJobDiagnostics,
  importJobs,
  operatorAuditLog,
} from "../../db/schema.ts";
import type { ImportJobTransaction } from "./import-job-store.ts";
import type {
  ClaimBoundInput,
  CompleteImportJobInput,
  FailImportJobInput,
  ImportJobClaim,
  ImportWorkerTransactionStore,
  UpdateImportJobProgressInput,
} from "./import-worker-core.ts";
import type { ImportSource } from "./import-job-core.ts";
import {
  exhaustedImportErrorCode,
  exhaustedImportErrorSummary,
} from "./import-worker-core.ts";

type ClaimRow = {
  id: number | string;
  source: string;
  mode: string;
  attempt_count: number;
  claim_token: string;
  lease_expires_at: Date | string;
  total_count: number;
  processed_count: number;
  imported_count: number;
  skipped_count: number;
  error_count: number;
};

type LockedJobRow = {
  id: number | string;
  claim_token: string;
  lease_valid: boolean;
  cancellation_requested: boolean;
  total_count: number;
  processed_count: number;
  imported_count: number;
  skipped_count: number;
  error_count: number;
};

export function createImportWorkerTransactionStore(
  transaction: ImportJobTransaction,
): ImportWorkerTransactionStore {
  return {
    claimNext: (claimToken, supportedSources) =>
      claimNext(transaction, claimToken, supportedSources),
    checkpoint: (input) => checkpoint(transaction, input),
    heartbeat: (input) => heartbeat(transaction, input),
    updateProgress: (input) => updateProgress(transaction, input),
    complete: (input) => complete(transaction, input),
    fail: (input) => fail(transaction, input),
    recoverExpiredExhausted: (limit) =>
      recoverExpiredExhausted(transaction, limit),
    insertDiagnostic: async (importJobId, code, safeSummary) => {
      await transaction.insert(importJobDiagnostics).values({
        importJobId,
        code,
        safeSummary,
      });
    },
    insertAuditRecord: async (record) => {
      await transaction.insert(operatorAuditLog).values(record);
    },
  };
}

async function checkpoint(
  transaction: ImportJobTransaction,
  input: ClaimBoundInput,
): Promise<"continue" | "cancelled" | "claim_lost"> {
  const current = await lockClaimedJob(transaction, input);
  if (!current || !current.lease_valid) return "claim_lost";

  if (current.cancellation_requested) {
    await transaction.execute(sql`
      WITH database_time AS MATERIALIZED (
        SELECT clock_timestamp() AS value
      )
      UPDATE ${importJobs}
      SET
        ${sql.identifier("status")} = 'cancelled'::import_job_status,
        ${sql.identifier("finished_at")} = GREATEST(
          ${importJobs.startedAt},
          database_time.value
        ),
        ${sql.identifier("updated_at")} = GREATEST(
          ${importJobs.updatedAt},
          ${importJobs.startedAt},
          database_time.value
        ),
        ${sql.identifier("claim_token")} = NULL,
        ${sql.identifier("lease_expires_at")} = NULL,
        ${sql.identifier("heartbeat_at")} = NULL
      FROM database_time
      WHERE ${importJobs.id} = ${input.importJobId}
    `);
    return "cancelled";
  }

  await transaction.execute(sql`
    WITH database_time AS MATERIALIZED (
      SELECT clock_timestamp() AS value
    )
    UPDATE ${importJobs}
    SET
      ${sql.identifier("heartbeat_at")} = GREATEST(
        ${importJobs.heartbeatAt},
        ${importJobs.startedAt},
        database_time.value
      ),
      ${sql.identifier("lease_expires_at")} = GREATEST(
        ${importJobs.heartbeatAt},
        ${importJobs.startedAt},
        database_time.value
      ) + interval '60 seconds',
      ${sql.identifier("updated_at")} = GREATEST(
        ${importJobs.updatedAt},
        database_time.value
      )
    FROM database_time
    WHERE ${importJobs.id} = ${input.importJobId}
  `);
  return "continue";
}

async function claimNext(
  transaction: ImportJobTransaction,
  claimToken: string,
  supportedSources: readonly ImportSource[],
): Promise<ImportJobClaim | null> {
  const rows = await transaction.execute<ClaimRow>(sql`
    WITH database_time AS MATERIALIZED (
      SELECT clock_timestamp() AS value
    ),
    candidate AS MATERIALIZED (
      SELECT ${importJobs.id} AS id
      FROM ${importJobs}, database_time
      WHERE ${inArray(importJobs.source, [...supportedSources])}
        AND (
          ${importJobs.status} = 'queued'
          OR (
            ${importJobs.status} = 'running'
            AND ${importJobs.leaseExpiresAt} < database_time.value
            AND ${importJobs.attemptCount} < 3
          )
        )
      ORDER BY
        CASE WHEN ${importJobs.status} = 'queued' THEN 0 ELSE 1 END,
        ${importJobs.createdAt},
        ${importJobs.id}
      FOR UPDATE OF ${importJobs} SKIP LOCKED
      LIMIT 1
    ),
    claimed AS (
      UPDATE ${importJobs}
      SET
        ${sql.identifier("status")} = 'running'::import_job_status,
        ${sql.identifier("attempt_count")} = ${importJobs.attemptCount} + 1,
        ${sql.identifier("claim_token")} = ${claimToken}::uuid,
        ${sql.identifier("started_at")} = COALESCE(
          ${importJobs.startedAt},
          GREATEST(${importJobs.createdAt}, database_time.value)
        ),
        ${sql.identifier("heartbeat_at")} = GREATEST(
          ${importJobs.createdAt},
          COALESCE(${importJobs.startedAt}, ${importJobs.createdAt}),
          database_time.value
        ),
        ${sql.identifier("lease_expires_at")} = GREATEST(
          ${importJobs.createdAt},
          COALESCE(${importJobs.startedAt}, ${importJobs.createdAt}),
          database_time.value
        ) + interval '60 seconds',
        ${sql.identifier("updated_at")} = GREATEST(
          ${importJobs.updatedAt},
          ${importJobs.createdAt},
          COALESCE(${importJobs.startedAt}, ${importJobs.createdAt}),
          database_time.value
        )
      FROM candidate, database_time
      WHERE ${importJobs.id} = candidate.id
      RETURNING
        ${importJobs.id} AS id,
        ${importJobs.source}::text AS source,
        ${importJobs.mode}::text AS mode,
        ${importJobs.attemptCount} AS attempt_count,
        ${importJobs.claimToken}::text AS claim_token,
        ${importJobs.leaseExpiresAt} AS lease_expires_at,
        ${importJobs.totalCount} AS total_count,
        ${importJobs.processedCount} AS processed_count,
        ${importJobs.importedCount} AS imported_count,
        ${importJobs.skippedCount} AS skipped_count,
        ${importJobs.errorCount} AS error_count
    )
    SELECT * FROM claimed
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: numericId(row.id),
    source: importSource(row.source),
    mode: importMode(row.mode),
    attemptCount: row.attempt_count,
    claimToken: row.claim_token,
    leaseExpiresAt: new Date(row.lease_expires_at),
    progress: {
      totalCount: row.total_count,
      processedCount: row.processed_count,
      importedCount: row.imported_count,
      skippedCount: row.skipped_count,
      errorCount: row.error_count,
    },
  };
}

async function heartbeat(
  transaction: ImportJobTransaction,
  input: ClaimBoundInput,
): Promise<boolean> {
  const rows = await transaction.execute<{ id: number | string }>(sql`
    WITH database_time AS MATERIALIZED (
      SELECT clock_timestamp() AS value
    )
    UPDATE ${importJobs}
    SET
      ${sql.identifier("heartbeat_at")} = GREATEST(
        ${importJobs.heartbeatAt},
        ${importJobs.startedAt},
        database_time.value
      ),
      ${sql.identifier("lease_expires_at")} = GREATEST(
        ${importJobs.heartbeatAt},
        ${importJobs.startedAt},
        database_time.value
      ) + interval '60 seconds',
      ${sql.identifier("updated_at")} = GREATEST(
        ${importJobs.updatedAt},
        database_time.value
      )
    FROM database_time
    WHERE ${importJobs.id} = ${input.importJobId}
      AND ${importJobs.status} = 'running'
      AND ${importJobs.claimToken} = ${input.claimToken}::uuid
      AND ${importJobs.leaseExpiresAt} >= database_time.value
    RETURNING ${importJobs.id} AS id
  `);
  return rows.length === 1;
}

async function updateProgress(
  transaction: ImportJobTransaction,
  input: UpdateImportJobProgressInput,
): Promise<"updated" | "claim_lost" | "regression"> {
  const current = await lockClaimedJob(transaction, input);
  if (!current || !current.lease_valid) return "claim_lost";
  if (
    input.totalCount < current.total_count ||
    input.processedCount < current.processed_count ||
    input.importedCount < current.imported_count ||
    input.skippedCount < current.skipped_count ||
    input.errorCount < current.error_count
  ) {
    return "regression";
  }
  await transaction.execute(sql`
    UPDATE ${importJobs}
    SET
      ${sql.identifier("total_rows")} = ${input.totalCount},
      ${sql.identifier("processed_count")} = ${input.processedCount},
      ${sql.identifier("imported_count")} = ${input.importedCount},
      ${sql.identifier("skipped_count")} = ${input.skippedCount},
      ${sql.identifier("error_count")} = ${input.errorCount},
      ${sql.identifier("updated_at")} = GREATEST(
        ${importJobs.updatedAt},
        clock_timestamp()
      )
    WHERE ${importJobs.id} = ${input.importJobId}
  `);
  return "updated";
}

async function complete(
  transaction: ImportJobTransaction,
  input: CompleteImportJobInput,
): Promise<"succeeded" | "cancelled" | "claim_lost" | "invalid_progress"> {
  const current = await lockClaimedJob(transaction, input);
  if (!current || !current.lease_valid) return "claim_lost";
  if (
    !current.cancellation_requested &&
    (input.totalCount !== input.processedCount ||
      input.totalCount < current.total_count ||
      input.processedCount < current.processed_count ||
      input.importedCount < current.imported_count ||
      input.skippedCount < current.skipped_count ||
      input.errorCount < current.error_count)
  ) {
    return "invalid_progress";
  }
  const status = current.cancellation_requested ? "cancelled" : "succeeded";
  await transaction.execute(sql`
    WITH database_time AS MATERIALIZED (
      SELECT clock_timestamp() AS value
    )
    UPDATE ${importJobs}
    SET
      ${sql.identifier("status")} = ${status}::import_job_status,
      ${sql.identifier("total_rows")} = CASE
        WHEN ${status} = 'succeeded' THEN ${input.totalCount}
        ELSE ${importJobs.totalCount}
      END,
      ${sql.identifier("processed_count")} = CASE
        WHEN ${status} = 'succeeded' THEN ${input.processedCount}
        ELSE ${importJobs.processedCount}
      END,
      ${sql.identifier("imported_count")} = CASE
        WHEN ${status} = 'succeeded' THEN ${input.importedCount}
        ELSE ${importJobs.importedCount}
      END,
      ${sql.identifier("skipped_count")} = CASE
        WHEN ${status} = 'succeeded' THEN ${input.skippedCount}
        ELSE ${importJobs.skippedCount}
      END,
      ${sql.identifier("error_count")} = CASE
        WHEN ${status} = 'succeeded' THEN ${input.errorCount}
        ELSE ${importJobs.errorCount}
      END,
      ${sql.identifier("finished_at")} = GREATEST(
        ${importJobs.startedAt},
        database_time.value
      ),
      ${sql.identifier("updated_at")} = GREATEST(
        ${importJobs.updatedAt},
        ${importJobs.startedAt},
        database_time.value
      ),
      ${sql.identifier("claim_token")} = NULL,
      ${sql.identifier("lease_expires_at")} = NULL,
      ${sql.identifier("heartbeat_at")} = NULL
    FROM database_time
    WHERE ${importJobs.id} = ${input.importJobId}
  `);
  return status;
}

async function fail(
  transaction: ImportJobTransaction,
  input: FailImportJobInput,
): Promise<boolean> {
  const current = await lockClaimedJob(transaction, input);
  if (!current || !current.lease_valid) return false;
  await transaction.execute(sql`
    WITH database_time AS MATERIALIZED (
      SELECT clock_timestamp() AS value
    )
    UPDATE ${importJobs}
    SET
      ${sql.identifier("status")} = 'failed'::import_job_status,
      ${sql.identifier("safe_error_code")} = ${input.safeErrorCode},
      ${sql.identifier("safe_error_summary")} = ${input.safeErrorSummary},
      ${sql.identifier("finished_at")} = GREATEST(
        ${importJobs.startedAt},
        database_time.value
      ),
      ${sql.identifier("updated_at")} = GREATEST(
        ${importJobs.updatedAt},
        ${importJobs.startedAt},
        database_time.value
      ),
      ${sql.identifier("claim_token")} = NULL,
      ${sql.identifier("lease_expires_at")} = NULL,
      ${sql.identifier("heartbeat_at")} = NULL
    FROM database_time
    WHERE ${importJobs.id} = ${input.importJobId}
  `);
  return true;
}

async function recoverExpiredExhausted(
  transaction: ImportJobTransaction,
  limit: number,
): Promise<number[]> {
  const rows = await transaction.execute<{ id: number | string }>(sql`
    SELECT ${importJobs.id} AS id
    FROM ${importJobs}
    WHERE ${importJobs.status} = 'running'
      AND ${importJobs.attemptCount} = 3
      AND ${importJobs.leaseExpiresAt} < clock_timestamp()
    ORDER BY ${importJobs.leaseExpiresAt}, ${importJobs.id}
    FOR UPDATE OF ${importJobs} SKIP LOCKED
    LIMIT ${limit}
  `);
  const ids = rows.map(({ id }) => numericId(id));
  for (const id of ids) {
    await transaction.execute(sql`
      WITH database_time AS MATERIALIZED (
        SELECT clock_timestamp() AS value
      )
      UPDATE ${importJobs}
      SET
        ${sql.identifier("status")} = 'failed'::import_job_status,
        ${sql.identifier("safe_error_code")} = ${exhaustedImportErrorCode},
        ${sql.identifier("safe_error_summary")} = ${exhaustedImportErrorSummary},
        ${sql.identifier("finished_at")} = GREATEST(
          ${importJobs.startedAt},
          database_time.value
        ),
        ${sql.identifier("updated_at")} = GREATEST(
          ${importJobs.updatedAt},
          ${importJobs.startedAt},
          database_time.value
        ),
        ${sql.identifier("claim_token")} = NULL,
        ${sql.identifier("lease_expires_at")} = NULL,
        ${sql.identifier("heartbeat_at")} = NULL
      FROM database_time
      WHERE ${importJobs.id} = ${id}
    `);
  }
  return ids;
}

async function lockClaimedJob(
  transaction: ImportJobTransaction,
  input: ClaimBoundInput,
): Promise<LockedJobRow | null> {
  const rows = await transaction.execute<LockedJobRow>(sql`
    SELECT
      ${importJobs.id} AS id,
      ${importJobs.claimToken}::text AS claim_token,
      ${importJobs.leaseExpiresAt} >= clock_timestamp() AS lease_valid,
      ${importJobs.cancellationRequestedAt} IS NOT NULL AS cancellation_requested,
      ${importJobs.totalCount} AS total_count,
      ${importJobs.processedCount} AS processed_count,
      ${importJobs.importedCount} AS imported_count,
      ${importJobs.skippedCount} AS skipped_count,
      ${importJobs.errorCount} AS error_count
    FROM ${importJobs}
    WHERE ${importJobs.id} = ${input.importJobId}
      AND ${importJobs.status} = 'running'
      AND ${importJobs.claimToken} = ${input.claimToken}::uuid
    FOR UPDATE OF ${importJobs}
  `);
  return rows[0] ?? null;
}

function numericId(value: number | string): number {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error("Database returned an invalid import job ID.");
  }
  return normalized;
}

function importSource(value: string): "ising" | "karafun" {
  if (value === "ising" || value === "karafun") return value;
  throw new Error("Database returned an invalid import source.");
}

function importMode(value: string): "validate" | "dry_run" | "write" {
  if (value === "validate" || value === "dry_run" || value === "write") {
    return value;
  }
  throw new Error("Database returned an invalid import mode.");
}
