import assert from "node:assert/strict";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import {
  createISingImportJob,
  ISING_IMPORT_FAILURE_ERROR,
  ISING_IMPORT_FAILURE_SUMMARY,
  markISingImportJobFailed,
  markISingImportJobSucceeded,
} from "../../src/db/import-ising.ts";
import {
  applyPostgresMigration,
  applyPostgresMigrations,
  createPostgresDatabase,
  createPostgresTestClient,
  dropPostgresDatabase,
  installPostgresCompatibilityFixture,
  postgresDatabaseName,
  postgresTestContainerExists,
  removePostgresTestHarness,
  startPostgresTestHarness,
  withPostgresClone,
  type SqlExecutor,
} from "./postgresTestHarness.ts";

type PgFailure = Error & {
  code?: string;
  constraint_name?: string;
};

type SeededContractData = {
  operatorId: number;
  cancellationOperatorId: number;
  jobIds: number[];
};

const images = ["postgres:15-alpine", "postgres:17-alpine"] as const;
const createdAt = "2026-07-16T10:00:00Z";
const startedAt = "2026-07-16T10:01:00Z";
const terminalAt = "2026-07-16T10:02:00Z";
const updatedAt = "2026-07-16T10:03:00Z";

test(
  "0018 finalizes the import job data contract on PostgreSQL 15 and 17",
  { timeout: 1_200_000 },
  async (context) => {
    for (const image of images) {
      await context.test(image, async () => {
        await verifyContractOnImage(image);
      });
    }
  },
);

async function verifyContractOnImage(image: (typeof images)[number]) {
  const version = image.startsWith("postgres:15") ? "15" : "17";
  const harness = await startPostgresTestHarness(
    `pozanuta-import-job-contract-pg${version}`,
    image,
  );
  const admin = createPostgresTestClient(harness, "postgres");
  const template = postgresDatabaseName(`import_job_contract_pg${version}`);

  try {
    await createPostgresDatabase(admin, template);
    const templateSql = createPostgresTestClient(harness, template);
    let seeded: SeededContractData;
    try {
      await installPostgresCompatibilityFixture(templateSql);
      await applyPostgresMigrations(templateSql, 17);
      seeded = await seedContractReadyData(templateSql);
    } finally {
      await templateSql.end({ timeout: 5 });
    }

    await withPostgresClone(
      harness,
      admin,
      template,
      `contract_success_pg${version}`,
      async (sql) => {
        await verifySuccessfulContract(sql, seeded);
      },
    );

    for (const contractCase of preflightCases(seeded)) {
      await withPostgresClone(
        harness,
        admin,
        template,
        `contract_${contractCase.name}_pg${version}`,
        async (sql) => {
          await contractCase.prepare(sql);
          await assert.rejects(
            applyPostgresMigration(sql, 18),
            (error: PgFailure) =>
              error.code === contractCase.code &&
              error.constraint_name === contractCase.constraint,
          );
          await assertContractWasNotPartiallyApplied(sql);
        },
      );
    }
  } finally {
    await dropPostgresDatabase(admin, template);
    await admin.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }

  assert.equal(
    await postgresTestContainerExists(harness.containerName),
    false,
    `${image} contract test container must be removed`,
  );
}

async function verifySuccessfulContract(
  sql: postgres.Sql,
  seeded: SeededContractData,
) {
  const rowsBefore = await readSeededRows(sql, seeded.jobIds, true);

  await applyPostgresMigration(sql, 18);

  assert.deepEqual(await readSeededRows(sql, seeded.jobIds, false), rowsBefore);
  assert.deepEqual(await readImportJobStatuses(sql), [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
  ]);
  await assertFinalColumnContract(sql);
  await assertFinalConstraintContract(sql);
  await assertIndexesAndDiagnosticsUnchanged(sql, seeded.jobIds[0]);
  await assertWriterUsesFinalContract(sql);
  await assertStatusAndConstraintMatrix(sql, seeded.operatorId);
  await assertForeignKeyActions(sql, seeded);
}

async function seedContractReadyData(
  sql: SqlExecutor,
): Promise<SeededContractData> {
  const operators = await sql<{ id: number }[]>`
    INSERT INTO operator_users (name, password_hash)
    VALUES
      ('Contract Operator', 'not-used-by-test'),
      ('Cancellation Operator', 'not-used-by-test')
    RETURNING id::int AS id
  `;
  const operator = operators[0];
  const cancellationOperator = operators[1];
  assert.ok(operator);
  assert.ok(cancellationOperator);

  const rows = await sql<{ id: number }[]>`
    INSERT INTO import_jobs (
      source,
      status,
      mode,
      initiator_kind,
      started_by_operator_id,
      total_rows,
      processed_count,
      imported_count,
      skipped_count,
      error_count,
      safe_error_code,
      safe_error_summary,
      error,
      created_at,
      started_at,
      finished_at,
      updated_at,
      cancellation_requested_at,
      cancellation_requested_by_operator_id,
      source_artifact_id,
      artifact_uploaded_at,
      artifact_deleted_at
    ) VALUES
      (
        'ising', 'succeeded', 'write', 'operator', ${operator.id},
        5, 5, 4, 1, 0, NULL, NULL, NULL,
        ${createdAt}, ${startedAt}, ${terminalAt}, ${updatedAt},
        NULL, NULL, NULL, NULL, NULL
      ),
      (
        'karafun', 'failed', 'write', 'legacy', NULL,
        8, 5, 4, 1, NULL,
        'LEGACY_IMPORT_FAILURE',
        'A legacy import failed. Historical error details were not retained.',
        NULL,
        ${createdAt}, ${startedAt}, ${terminalAt}, ${updatedAt},
        NULL, NULL,
        '00000000-0000-4000-8000-000000000001', ${createdAt}, NULL
      ),
      (
        'ising', 'cancelled', 'write', 'system', NULL,
        2, 2, 2, 0, 0, NULL, NULL, NULL,
        ${createdAt}, NULL, ${terminalAt}, ${updatedAt},
        ${startedAt}, ${cancellationOperator.id}, NULL, NULL, NULL
      )
    RETURNING id::int AS id
  `;

  return {
    operatorId: operator.id,
    cancellationOperatorId: cancellationOperator.id,
    jobIds: rows.map(({ id }) => id),
  };
}

async function readSeededRows(
  sql: SqlExecutor,
  ids: number[],
  includeLegacyError: boolean,
) {
  const legacyErrorProjection = includeLegacyError
    ? ", error"
    : ", NULL::text AS error";
  return sql.unsafe(
    `SELECT
       id::int AS id,
       source::text AS source,
       status::text AS status,
       mode::text AS mode,
       initiator_kind::text AS "initiatorKind",
       started_by_operator_id::int AS "startedByOperatorId",
       total_rows AS "totalCount",
       processed_count AS "processedCount",
       imported_count AS "importedCount",
       skipped_count AS "skippedCount",
       error_count AS "errorCount",
       safe_error_code AS "safeErrorCode",
       safe_error_summary AS "safeErrorSummary",
       created_at::text AS "createdAt",
       started_at::text AS "startedAt",
       finished_at::text AS "terminalAt",
       updated_at::text AS "updatedAt",
       cancellation_requested_at::text AS "cancellationRequestedAt",
       cancellation_requested_by_operator_id::int AS "cancellationRequestedByOperatorId",
       source_artifact_id::text AS "sourceArtifactId",
       artifact_uploaded_at::text AS "artifactUploadedAt",
       artifact_deleted_at::text AS "artifactDeletedAt"
       ${legacyErrorProjection}
     FROM import_jobs
     WHERE id = ANY($1::bigint[])
     ORDER BY id`,
    [ids],
  );
}

async function assertFinalColumnContract(sql: SqlExecutor) {
  const columns = await sql<
    Array<{
      name: string;
      nullable: string;
      defaultValue: string | null;
    }>
  >`
    SELECT
      column_name AS name,
      is_nullable AS nullable,
      column_default AS "defaultValue"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'import_jobs'
    ORDER BY ordinal_position
  `;
  const byName = new Map(columns.map((column) => [column.name, column]));

  assert.equal(byName.has("error"), false);
  assert.equal(byName.get("processed_count")?.nullable, "NO");
  assert.match(byName.get("created_at")?.defaultValue ?? "", /now\(\)/);
  for (const name of ["status", "mode", "initiator_kind", "updated_at"]) {
    assert.equal(byName.get(name)?.defaultValue, null);
  }
}

async function assertFinalConstraintContract(sql: SqlExecutor) {
  const constraints = await sql<
    Array<{ name: string; type: string; definition: string }>
  >`
    SELECT
      conname AS name,
      contype::text AS type,
      pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.import_jobs'::regclass
    ORDER BY conname
  `;
  const byName = new Map(constraints.map((constraint) => [constraint.name, constraint]));
  for (const name of [
    "import_jobs_counts_check",
    "import_jobs_progress_check",
    "import_jobs_safe_error_check",
    "import_jobs_lifecycle_check",
    "import_jobs_initiator_check",
    "import_jobs_timestamp_order_check",
    "import_jobs_artifact_state_check",
    "import_jobs_cancellation_request_check",
  ]) {
    assert.equal(byName.get(name)?.type, "c", `Missing check ${name}`);
  }
  assert.equal(byName.has("import_jobs_expand_counts_check"), false);
  assert.equal(byName.has("import_jobs_safe_error_pair_check"), false);
  assert.match(
    byName.get("import_jobs_started_by_operator_fk")?.definition ?? "",
    /FOREIGN KEY \(started_by_operator_id\).*ON DELETE RESTRICT/,
  );
  assert.match(
    byName.get("import_jobs_cancel_requested_by_operator_fk")?.definition ?? "",
    /FOREIGN KEY \(cancellation_requested_by_operator_id\).*ON DELETE SET NULL/,
  );
}

async function assertIndexesAndDiagnosticsUnchanged(
  sql: postgres.Sql,
  importJobId: number,
) {
  const indexes = await sql<
    Array<{ name: string; valid: boolean; ready: boolean }>
  >`
    SELECT
      index_class.relname AS name,
      indexes.indisvalid AS valid,
      indexes.indisready AS ready
    FROM pg_index indexes
    JOIN pg_class table_class ON table_class.oid = indexes.indrelid
    JOIN pg_class index_class ON index_class.oid = indexes.indexrelid
    JOIN pg_namespace table_schema ON table_schema.oid = table_class.relnamespace
    WHERE table_schema.nspname = 'public'
      AND table_class.relname = 'import_jobs'
    ORDER BY index_class.relname
  `;
  assert.deepEqual(
    indexes.map(({ name }) => name),
    [
      "import_jobs_artifact_uploaded_at_idx",
      "import_jobs_cancellation_requested_by_operator_idx",
      "import_jobs_one_active_per_source_idx",
      "import_jobs_pkey",
      "import_jobs_source_status_created_at_idx",
      "import_jobs_started_by_operator_idx",
      "import_jobs_terminal_at_idx",
    ],
  );
  for (const index of indexes) {
    assert.equal(index.valid, true, `${index.name} must be valid`);
    assert.equal(index.ready, true, `${index.name} must be ready`);
  }
  const [diagnostics] = await sql<
    Array<{ rls: boolean; policyCount: number }>
  >`
    SELECT
      relrowsecurity AS rls,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'import_job_diagnostics') AS "policyCount"
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = 'import_job_diagnostics'
  `;
  assert.deepEqual(diagnostics, { rls: true, policyCount: 0 });

  const [diagnostic] = await sql<{ id: number }[]>`
    INSERT INTO import_job_diagnostics (import_job_id, code, safe_summary)
    VALUES (${importJobId}, 'CONTRACT_VERIFIED', 'Contract verification diagnostic.')
    RETURNING id::int AS id
  `;
  assert.ok(diagnostic);
  await sql.unsafe("GRANT USAGE ON SCHEMA public TO anon, authenticated");
  await sql.unsafe(
    "GRANT SELECT, INSERT ON public.import_job_diagnostics TO anon, authenticated",
  );
  await sql.unsafe(
    "GRANT USAGE, SELECT ON SEQUENCE public.import_job_diagnostics_id_seq TO anon, authenticated",
  );
  for (const role of ["anon", "authenticated"] as const) {
    const visible = await sql.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL ROLE ${role}`);
      return transaction`
        SELECT id FROM import_job_diagnostics WHERE id = ${diagnostic.id}
      `;
    });
    assert.deepEqual([...visible], []);
    await assert.rejects(
      sql.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL ROLE ${role}`);
        await transaction`
          INSERT INTO import_job_diagnostics (
            import_job_id, code, safe_summary
          ) VALUES (
            ${importJobId},
            'BROWSER_WRITE',
            'Browser roles must not persist diagnostics.'
          )
        `;
      }),
      (error: PgFailure) => error.code === "42501",
    );
  }
}

async function assertWriterUsesFinalContract(sql: postgres.Sql) {
  const database = drizzle({ client: sql });
  const firstStart = new Date("2026-07-16T11:00:00Z");
  const firstEnd = new Date("2026-07-16T11:01:00Z");
  const successId = await createISingImportJob(database, firstStart);
  await markISingImportJobSucceeded(
    database,
    successId,
    {
      processed: 4,
      inserted: 2,
      updated: 1,
      skipped: 1,
      errors: 0,
      pages: 1,
      dryRun: false,
    },
    firstEnd,
  );

  const failureId = await createISingImportJob(
    database,
    new Date("2026-07-16T12:00:00Z"),
  );
  await markISingImportJobFailed(
    database,
    failureId,
    new Date("2026-07-16T12:01:00Z"),
  );

  const jobs = await sql`
    SELECT
      id::int AS id,
      status::text AS status,
      total_rows AS "totalCount",
      processed_count AS "processedCount",
      imported_count AS "importedCount",
      skipped_count AS "skippedCount",
      error_count AS "errorCount",
      safe_error_code AS "safeErrorCode",
      safe_error_summary AS "safeErrorSummary"
    FROM import_jobs
    WHERE id IN (${successId}, ${failureId})
    ORDER BY id
  `;
  assert.deepEqual([...jobs], [
    {
      id: successId,
      status: "succeeded",
      totalCount: 4,
      processedCount: 4,
      importedCount: 3,
      skippedCount: 1,
      errorCount: 0,
      safeErrorCode: null,
      safeErrorSummary: null,
    },
    {
      id: failureId,
      status: "failed",
      totalCount: 0,
      processedCount: 0,
      importedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      safeErrorCode: ISING_IMPORT_FAILURE_ERROR,
      safeErrorSummary: ISING_IMPORT_FAILURE_SUMMARY,
    },
  ]);
}

async function assertStatusAndConstraintMatrix(
  sql: SqlExecutor,
  operatorId: number,
) {
  for (const values of [
    validJob("queued"),
    validJob("running"),
    validJob("succeeded"),
    validJob("failed"),
    validJob("cancelled"),
  ]) {
    const [row] = await insertContractJob(sql, values);
    assert.ok(row);
    await sql`DELETE FROM import_jobs WHERE id = ${row.id}`;
  }

  await assertCheckViolation(
    insertContractJob(sql, { ...validJob("queued"), startedAt }),
    "import_jobs_lifecycle_check",
  );
  await assertCheckViolation(
    insertContractJob(sql, {
      ...validJob("succeeded"),
      startedAt: "2026-07-16T09:59:00Z",
    }),
    "import_jobs_timestamp_order_check",
  );
  await assertCheckViolation(
    insertContractJob(sql, {
      ...validJob("running"),
      updatedAt: "2026-07-16T10:00:30Z",
    }),
    "import_jobs_timestamp_order_check",
  );
  await assertCheckViolation(
    insertContractJob(sql, {
      ...validJob("succeeded"),
      updatedAt: "2026-07-16T10:01:30Z",
    }),
    "import_jobs_timestamp_order_check",
  );
  await assertCheckViolation(
    insertContractJob(sql, {
      ...validJob("succeeded"),
      initiatorKind: "system",
      startedByOperatorId: operatorId,
    }),
    "import_jobs_initiator_check",
  );
  await assertCheckViolation(
    insertContractJob(sql, {
      ...validJob("succeeded"),
      totalCount: 2,
      processedCount: 2,
      importedCount: 1,
    }),
    "import_jobs_progress_check",
  );
  await assertCheckViolation(
    insertContractJob(sql, {
      ...validJob("failed"),
      safeErrorCode: null,
      safeErrorSummary: null,
    }),
    "import_jobs_safe_error_check",
  );
  await assertCheckViolation(
    insertContractJob(sql, {
      ...validJob("succeeded"),
      safeErrorCode: "UNEXPECTED",
      safeErrorSummary: "Unexpected safe error.",
    }),
    "import_jobs_safe_error_check",
  );
  await assertCheckViolation(
    insertContractJob(sql, {
      ...validJob("cancelled"),
      cancellationRequestedByOperatorId: operatorId,
      cancellationRequestedAt: null,
    }),
    "import_jobs_cancellation_request_check",
  );
  await assertCheckViolation(
    insertContractJob(sql, {
      ...validJob("succeeded"),
      artifactUploadedAt: startedAt,
    }),
    "import_jobs_artifact_state_check",
  );
  await assertCheckViolation(
    insertContractJob(sql, {
      ...validJob("failed"),
      initiatorKind: "system",
      errorCount: null,
    }),
    "import_jobs_progress_check",
  );

  const legacyFailure = await insertContractJob(sql, {
    ...validJob("failed"),
    initiatorKind: "legacy",
    errorCount: null,
  });
  assert.equal(legacyFailure.length, 1);
}

async function assertForeignKeyActions(
  sql: SqlExecutor,
  seeded: SeededContractData,
) {
  await assert.rejects(
    sql`DELETE FROM operator_users WHERE id = ${seeded.operatorId}`,
    (error: PgFailure) =>
      error.code === "23503" &&
      error.constraint_name === "import_jobs_started_by_operator_fk",
  );

  await sql`
    DELETE FROM operator_users
    WHERE id = ${seeded.cancellationOperatorId}
  `;
  const [cancelled] = await sql<
    Array<{ cancellationOperatorId: number | null }>
  >`
    SELECT cancellation_requested_by_operator_id::int AS "cancellationOperatorId"
    FROM import_jobs
    WHERE id = ${seeded.jobIds[2]}
  `;
  assert.equal(cancelled?.cancellationOperatorId, null);
}

type ContractJob = {
  source: "ising" | "karafun";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  mode: "validate" | "dry_run" | "write";
  initiatorKind: "operator" | "system" | "legacy";
  startedByOperatorId: number | null;
  totalCount: number;
  processedCount: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number | null;
  safeErrorCode: string | null;
  safeErrorSummary: string | null;
  createdAt: string;
  startedAt: string | null;
  terminalAt: string | null;
  updatedAt: string;
  cancellationRequestedAt: string | null;
  cancellationRequestedByOperatorId: number | null;
  sourceArtifactId: string | null;
  artifactUploadedAt: string | null;
  artifactDeletedAt: string | null;
};

function validJob(status: ContractJob["status"]): ContractJob {
  const failed = status === "failed";
  return {
    source: "karafun",
    status,
    mode: "write",
    initiatorKind: "system",
    startedByOperatorId: null,
    totalCount: 0,
    processedCount: 0,
    importedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    safeErrorCode: failed ? "IMPORT_FAILED" : null,
    safeErrorSummary: failed ? "The import failed safely." : null,
    createdAt,
    startedAt:
      status === "queued" || status === "cancelled" ? null : startedAt,
    terminalAt:
      status === "succeeded" || status === "failed" || status === "cancelled"
        ? terminalAt
        : null,
    updatedAt,
    cancellationRequestedAt: null,
    cancellationRequestedByOperatorId: null,
    sourceArtifactId: null,
    artifactUploadedAt: null,
    artifactDeletedAt: null,
  };
}

async function insertContractJob(sql: SqlExecutor, job: ContractJob) {
  return sql<{ id: number }[]>`
    INSERT INTO import_jobs (
      source, status, mode, initiator_kind, started_by_operator_id,
      total_rows, processed_count, imported_count, skipped_count, error_count,
      safe_error_code, safe_error_summary,
      created_at, started_at, finished_at, updated_at,
      cancellation_requested_at, cancellation_requested_by_operator_id,
      source_artifact_id, artifact_uploaded_at, artifact_deleted_at
    ) VALUES (
      ${job.source}, ${job.status}, ${job.mode}, ${job.initiatorKind}, ${job.startedByOperatorId},
      ${job.totalCount}, ${job.processedCount}, ${job.importedCount}, ${job.skippedCount}, ${job.errorCount},
      ${job.safeErrorCode}, ${job.safeErrorSummary},
      ${job.createdAt}, ${job.startedAt}, ${job.terminalAt}, ${job.updatedAt},
      ${job.cancellationRequestedAt}, ${job.cancellationRequestedByOperatorId},
      ${job.sourceArtifactId}, ${job.artifactUploadedAt}, ${job.artifactDeletedAt}
    )
    RETURNING id::int AS id
  `;
}

function preflightCases(seeded: SeededContractData) {
  return [
    {
      name: "status",
      code: "23514",
      constraint: "import_jobs_status_contract",
      prepare: async (sql: SqlExecutor) => {
        await sql.unsafe(
          "ALTER TYPE public.import_job_status ADD VALUE 'unexpected'",
        );
      },
    },
    {
      name: "lifecycle",
      code: "23514",
      constraint: "import_jobs_lifecycle_check",
      prepare: (sql: SqlExecutor) =>
        insert0017Job(sql, { status: "queued", startedAt }),
    },
    {
      name: "timestamps",
      code: "23514",
      constraint: "import_jobs_timestamp_order_check",
      prepare: (sql: SqlExecutor) =>
        insert0017Job(sql, {
          status: "succeeded",
          startedAt: "2026-07-16T09:59:00Z",
          terminalAt,
        }),
    },
    {
      name: "updated_before_started",
      code: "23514",
      constraint: "import_jobs_timestamp_order_check",
      prepare: (sql: SqlExecutor) =>
        insert0017Job(sql, {
          status: "running",
          startedAt,
          updatedAt: "2026-07-16T10:00:30Z",
        }),
    },
    {
      name: "updated_before_finished",
      code: "23514",
      constraint: "import_jobs_timestamp_order_check",
      prepare: (sql: SqlExecutor) =>
        insert0017Job(sql, {
          status: "succeeded",
          startedAt,
          terminalAt,
          updatedAt: "2026-07-16T10:01:30Z",
        }),
    },
    {
      name: "initiator",
      code: "23514",
      constraint: "import_jobs_initiator_check",
      prepare: (sql: SqlExecutor) =>
        insert0017Job(sql, {
          status: "succeeded",
          initiatorKind: "system",
          startedByOperatorId: seeded.operatorId,
          startedAt,
          terminalAt,
        }),
    },
    {
      name: "progress",
      code: "23514",
      constraint: "import_jobs_progress_check",
      prepare: async (sql: SqlExecutor) => {
        await sql`ALTER TABLE import_jobs DROP CONSTRAINT import_jobs_expand_counts_check`;
        await insert0017Job(sql, {
          status: "succeeded",
          totalCount: 2,
          processedCount: 2,
          importedCount: 1,
          startedAt,
          terminalAt,
        });
      },
    },
    {
      name: "safe_error",
      code: "23514",
      constraint: "import_jobs_safe_error_check",
      prepare: async (sql: SqlExecutor) => {
        await sql`ALTER TABLE import_jobs DROP CONSTRAINT import_jobs_safe_error_pair_check`;
        await insert0017Job(sql, {
          status: "failed",
          initiatorKind: "legacy",
          errorCount: null,
          safeErrorCode: null,
          safeErrorSummary: null,
          startedAt,
          terminalAt,
        });
      },
    },
    {
      name: "raw_error",
      code: "23514",
      constraint: "import_jobs_legacy_error_empty",
      prepare: (sql: SqlExecutor) =>
        insert0017Job(sql, {
          status: "succeeded",
          startedAt,
          terminalAt,
          rawError: "raw-test-error",
        }),
    },
    {
      name: "cancellation",
      code: "23514",
      constraint: "import_jobs_cancellation_request_check",
      prepare: async (sql: SqlExecutor) => {
        await sql`ALTER TABLE import_jobs DROP CONSTRAINT import_jobs_cancellation_request_check`;
        await insert0017Job(sql, {
          status: "cancelled",
          terminalAt,
          cancellationRequestedByOperatorId: seeded.cancellationOperatorId,
        });
      },
    },
    {
      name: "artifact",
      code: "23514",
      constraint: "import_jobs_artifact_state_check",
      prepare: async (sql: SqlExecutor) => {
        await sql`ALTER TABLE import_jobs DROP CONSTRAINT import_jobs_artifact_state_check`;
        await insert0017Job(sql, {
          status: "succeeded",
          startedAt,
          terminalAt,
          artifactUploadedAt: startedAt,
        });
      },
    },
    {
      name: "duplicate",
      code: "23505",
      constraint: "import_jobs_one_active_per_source_idx",
      prepare: async (sql: SqlExecutor) => {
        await sql`DROP INDEX import_jobs_one_active_per_source_idx`;
        await insert0017Job(sql, { status: "queued" });
        await insert0017Job(sql, { status: "queued" });
      },
    },
    {
      name: "index_contract",
      code: "23514",
      constraint: "import_jobs_index_contract",
      prepare: async (sql: SqlExecutor) => {
        await sql`DROP INDEX import_jobs_terminal_at_idx`;
      },
    },
    {
      name: "invalid_index_contract",
      code: "23514",
      constraint: "import_jobs_index_contract",
      prepare: async (sql: SqlExecutor) => {
        await sql`DROP INDEX import_jobs_one_active_per_source_idx`;
        await insert0017Job(sql, { status: "queued" });
        await insert0017Job(sql, { status: "queued" });
        await assert.rejects(
          sql.unsafe(
            `CREATE UNIQUE INDEX CONCURRENTLY import_jobs_one_active_per_source_idx
             ON public.import_jobs USING btree (source)
             WHERE status IN ('queued', 'running')`,
          ),
          (error: PgFailure) => error.code === "23505",
        );
        const [invalidIndex] = await sql<
          Array<{ valid: boolean; ready: boolean }>
        >`
          SELECT indisvalid AS valid, indisready AS ready
          FROM pg_index
          WHERE indexrelid = 'public.import_jobs_one_active_per_source_idx'::regclass
        `;
        assert.ok(invalidIndex);
        assert.equal(invalidIndex.valid && invalidIndex.ready, false);
        await sql`
          DELETE FROM import_jobs
          WHERE id = (
            SELECT max(id)
            FROM import_jobs
            WHERE source = 'ising' AND status IN ('queued', 'running')
          )
        `;
        const [active] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM import_jobs
          WHERE source = 'ising' AND status IN ('queued', 'running')
        `;
        assert.equal(active?.count, 1);
      },
    },
    {
      name: "started_fk",
      code: "23514",
      constraint: "import_jobs_started_by_operator_fk_source",
      prepare: (sql: SqlExecutor) =>
        replaceOperatorForeignKey(
          sql,
          "started_by_operator_id",
          "unexpected_started_by_fk",
          "CASCADE",
        ),
    },
    {
      name: "cancellation_fk",
      code: "23514",
      constraint: "import_jobs_cancel_requested_by_operator_fk_source",
      prepare: (sql: SqlExecutor) =>
        replaceOperatorForeignKey(
          sql,
          "cancellation_requested_by_operator_id",
          "unexpected_cancellation_fk",
          "CASCADE",
        ),
    },
  ];
}

type Job0017Overrides = Partial<{
  status: string;
  initiatorKind: "operator" | "system" | "legacy";
  startedByOperatorId: number | null;
  totalCount: number;
  processedCount: number | null;
  importedCount: number;
  skippedCount: number;
  errorCount: number | null;
  safeErrorCode: string | null;
  safeErrorSummary: string | null;
  startedAt: string | null;
  terminalAt: string | null;
  updatedAt: string;
  cancellationRequestedByOperatorId: number | null;
  artifactUploadedAt: string | null;
  rawError: string | null;
}>;

async function insert0017Job(
  sql: SqlExecutor,
  overrides: Job0017Overrides,
) {
  const failed = overrides.status === "failed";
  const values = {
    status: overrides.status ?? "succeeded",
    initiatorKind: overrides.initiatorKind ?? "system",
    startedByOperatorId: overrides.startedByOperatorId ?? null,
    totalCount: overrides.totalCount ?? 0,
    processedCount: overrides.processedCount ?? 0,
    importedCount: overrides.importedCount ?? 0,
    skippedCount: overrides.skippedCount ?? 0,
    errorCount: Object.hasOwn(overrides, "errorCount")
      ? (overrides.errorCount ?? null)
      : 0,
    safeErrorCode: Object.hasOwn(overrides, "safeErrorCode")
      ? (overrides.safeErrorCode ?? null)
      : failed
        ? "IMPORT_FAILED"
        : null,
    safeErrorSummary: Object.hasOwn(overrides, "safeErrorSummary")
      ? (overrides.safeErrorSummary ?? null)
      : failed
        ? "The import failed safely."
        : null,
    startedAt: Object.hasOwn(overrides, "startedAt")
      ? (overrides.startedAt ?? null)
      : null,
    terminalAt: Object.hasOwn(overrides, "terminalAt")
      ? (overrides.terminalAt ?? null)
      : null,
    updatedAt: overrides.updatedAt ?? updatedAt,
    cancellationRequestedByOperatorId:
      overrides.cancellationRequestedByOperatorId ?? null,
    artifactUploadedAt: overrides.artifactUploadedAt ?? null,
    rawError: overrides.rawError ?? null,
  };

  await sql.unsafe(
    `INSERT INTO import_jobs (
       source, status, mode, initiator_kind, started_by_operator_id,
       total_rows, processed_count, imported_count, skipped_count, error_count,
       safe_error_code, safe_error_summary, error,
       created_at, started_at, finished_at, updated_at,
       cancellation_requested_at, cancellation_requested_by_operator_id,
       source_artifact_id, artifact_uploaded_at, artifact_deleted_at
     ) VALUES (
       'ising', $1::public.import_job_status, 'write', $2, $3,
       $4, $5, $6, $7, $8,
       $9, $10, $11,
       $12, $13, $14, $15,
       NULL, $16,
       NULL, $17, NULL
     )`,
    [
      values.status,
      values.initiatorKind,
      values.startedByOperatorId,
      values.totalCount,
      values.processedCount,
      values.importedCount,
      values.skippedCount,
      values.errorCount,
      values.safeErrorCode,
      values.safeErrorSummary,
      values.rawError,
      createdAt,
      values.startedAt,
      values.terminalAt,
      values.updatedAt,
      values.cancellationRequestedByOperatorId,
      values.artifactUploadedAt,
    ],
  );
}

async function replaceOperatorForeignKey(
  sql: SqlExecutor,
  column: string,
  replacementName: string,
  onDelete: "CASCADE",
) {
  assert.match(column, /^[a-z_]+$/);
  assert.match(replacementName, /^[a-z_]+$/);
  await sql.unsafe(
    `DO $$
     DECLARE existing_name text;
     BEGIN
       SELECT c.conname
       INTO STRICT existing_name
       FROM pg_constraint c
       WHERE c.contype = 'f'
         AND c.conrelid = 'public.import_jobs'::regclass
         AND c.conkey = ARRAY[
           (
             SELECT attnum
             FROM pg_attribute
             WHERE attrelid = 'public.import_jobs'::regclass
               AND attname = '${column}'
               AND NOT attisdropped
           )
         ]::smallint[];
       EXECUTE format('ALTER TABLE public.import_jobs DROP CONSTRAINT %I', existing_name);
     END;
     $$;
     ALTER TABLE public.import_jobs
     ADD CONSTRAINT "${replacementName}"
     FOREIGN KEY ("${column}")
     REFERENCES public.operator_users(id)
     ON DELETE ${onDelete}
     ON UPDATE NO ACTION;`,
  );
}

async function assertContractWasNotPartiallyApplied(sql: SqlExecutor) {
  const [state] = await sql<
    Array<{
      hasErrorColumn: boolean;
      processedNullable: string;
      statusDefault: string | null;
      hasFinalLifecycle: boolean;
    }>
  >`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'import_jobs' AND column_name = 'error'
      ) AS "hasErrorColumn",
      (
        SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'import_jobs' AND column_name = 'processed_count'
      ) AS "processedNullable",
      (
        SELECT column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'import_jobs' AND column_name = 'status'
      ) AS "statusDefault",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.import_jobs'::regclass
          AND conname = 'import_jobs_lifecycle_check'
      ) AS "hasFinalLifecycle"
  `;
  assert.ok(state);
  assert.equal(state.hasErrorColumn, true);
  assert.equal(state.processedNullable, "YES");
  assert.match(state.statusDefault ?? "", /queued/);
  assert.equal(state.hasFinalLifecycle, false);
}

async function readImportJobStatuses(sql: SqlExecutor) {
  const rows = await sql<{ value: string }[]>`
    SELECT enumlabel AS value
    FROM pg_enum
    JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_type.typname = 'import_job_status'
    ORDER BY enumsortorder
  `;
  return rows.map(({ value }) => value);
}

async function assertCheckViolation(
  operation: Promise<unknown>,
  constraint: string,
) {
  await assert.rejects(
    operation,
    (error: PgFailure) =>
      error.code === "23514" && error.constraint_name === constraint,
  );
}
