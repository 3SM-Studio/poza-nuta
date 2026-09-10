import { sql } from "drizzle-orm";

import {
  importJobs,
  operatorAuditLog,
  operatorUsers,
  platformMembers,
} from "../../db/schema.ts";
import type {
  EnqueueImportJobInput,
  ImportJobActorAccess,
  ImportJobMutationResult,
  ImportJobTransactionStore,
  RequestImportCancellationInput,
} from "./import-job-core.ts";

type Database = typeof import("../db.ts").getDb extends () => infer T ? T : never;
export type ImportJobTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

type ActorRow = { role: string };
type JobRow = {
  id: number | string;
  source: string;
  status: string;
  changed: boolean;
};

export function createImportJobTransactionStore(
  transaction: ImportJobTransaction,
): ImportJobTransactionStore {
  return {
    findActorAccess: (operatorId) => findActorAccess(transaction, operatorId),
    enqueue: (operatorId, input) => enqueue(transaction, operatorId, input),
    requestCancellation: (operatorId, input) =>
      requestCancellation(transaction, operatorId, input),
    insertAuditRecord: async (record) => {
      await transaction.insert(operatorAuditLog).values(record);
    },
  };
}

async function findActorAccess(
  transaction: ImportJobTransaction,
  operatorId: number,
): Promise<ImportJobActorAccess | null> {
  const rows = await transaction.execute<ActorRow>(sql`
    SELECT ${platformMembers.role}::text AS role
    FROM ${operatorUsers}
    JOIN ${platformMembers}
      ON ${platformMembers.operatorUserId} = ${operatorUsers.id}
    WHERE ${operatorUsers.id} = ${operatorId}
      AND ${operatorUsers.active} = true
      AND ${operatorUsers.suspendedAt} IS NULL
      AND ${platformMembers.active} = true
      AND ${platformMembers.role} IN ('platform_owner', 'platform_admin')
    FOR SHARE OF ${operatorUsers}, ${platformMembers}
  `);
  const role = rows[0]?.role;
  if (role !== "platform_owner" && role !== "platform_admin") return null;
  return { role };
}

async function enqueue(
  transaction: ImportJobTransaction,
  actorOperatorId: number,
  input: EnqueueImportJobInput,
): Promise<ImportJobMutationResult> {
  const rows = await transaction.execute<JobRow>(sql`
    WITH database_time AS MATERIALIZED (
      SELECT clock_timestamp() AS value
    )
    INSERT INTO ${importJobs} (
      ${sql.identifier("source")},
      ${sql.identifier("status")},
      ${sql.identifier("mode")},
      ${sql.identifier("initiator_kind")},
      ${sql.identifier("started_by_operator_id")},
      ${sql.identifier("total_rows")},
      ${sql.identifier("processed_count")},
      ${sql.identifier("imported_count")},
      ${sql.identifier("skipped_count")},
      ${sql.identifier("error_count")},
      ${sql.identifier("created_at")},
      ${sql.identifier("updated_at")},
      ${sql.identifier("attempt_count")}
    )
    SELECT
      ${input.source}::import_source,
      'queued'::import_job_status,
      ${input.mode}::import_job_mode,
      'operator'::import_job_initiator_kind,
      ${actorOperatorId},
      0, 0, 0, 0, 0,
      database_time.value,
      database_time.value,
      0
    FROM database_time
    RETURNING
      ${importJobs.id} AS id,
      ${importJobs.source}::text AS source,
      ${importJobs.status}::text AS status,
      true AS changed
  `);
  return jobResult(rows[0]);
}

async function requestCancellation(
  transaction: ImportJobTransaction,
  actorOperatorId: number,
  input: RequestImportCancellationInput,
): Promise<ImportJobMutationResult | null> {
  const rows = await transaction.execute<JobRow>(sql`
    WITH current_job AS MATERIALIZED (
      SELECT
        ${importJobs.id} AS id,
        ${importJobs.source} AS source,
        ${importJobs.status} AS status,
        ${importJobs.cancellationRequestedAt} AS cancellation_requested_at
      FROM ${importJobs}
      WHERE ${importJobs.id} = ${input.importJobId}
      FOR UPDATE
    ),
    database_time AS MATERIALIZED (
      SELECT clock_timestamp() AS value
    ),
    changed_job AS (
      UPDATE ${importJobs}
      SET
        ${sql.identifier("status")} = CASE
          WHEN current_job.status = 'queued' THEN 'cancelled'::import_job_status
          ELSE ${importJobs.status}
        END,
        ${sql.identifier("cancellation_requested_at")} = database_time.value,
        ${sql.identifier("cancellation_requested_by_operator_id")} = ${actorOperatorId},
        ${sql.identifier("finished_at")} = CASE
          WHEN current_job.status = 'queued' THEN database_time.value
          ELSE ${importJobs.terminalAt}
        END,
        ${sql.identifier("updated_at")} = GREATEST(
          ${importJobs.updatedAt},
          database_time.value
        )
      FROM current_job, database_time
      WHERE ${importJobs.id} = current_job.id
        AND current_job.status IN ('queued', 'running')
        AND current_job.cancellation_requested_at IS NULL
      RETURNING ${importJobs.id}
    )
    SELECT
      current_job.id AS id,
      current_job.source::text AS source,
      CASE
        WHEN current_job.status = 'queued'
          AND EXISTS (SELECT 1 FROM changed_job)
          THEN 'cancelled'
        ELSE current_job.status::text
      END AS status,
      EXISTS (SELECT 1 FROM changed_job) AS changed
    FROM current_job
  `);
  return rows[0] ? jobResult(rows[0]) : null;
}

function jobResult(row: JobRow | undefined): ImportJobMutationResult {
  if (!row) throw new Error("Import job mutation returned no row.");
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Import job mutation returned an invalid ID.");
  }
  if (row.source !== "ising" && row.source !== "karafun") {
    throw new Error("Import job mutation returned an invalid source.");
  }
  if (!isJobStatus(row.status)) {
    throw new Error("Import job mutation returned an invalid status.");
  }
  return { id, source: row.source, status: row.status, changed: row.changed };
}

function isJobStatus(
  value: string,
): value is ImportJobMutationResult["status"] {
  return ["queued", "running", "succeeded", "failed", "cancelled"].includes(
    value,
  );
}
