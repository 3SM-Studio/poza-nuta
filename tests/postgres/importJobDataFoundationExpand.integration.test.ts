import assert from "node:assert/strict";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";

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
  createPostgresTestClient,
  installPostgresCompatibilityFixture,
  postgresTestContainerExists,
  removePostgresTestHarness,
  startPostgresTestHarness,
  withBlankPostgresDatabase,
  type SqlExecutor,
} from "./postgresTestHarness.ts";

type PgFailure = Error & {
  code?: string;
  constraint_name?: string;
};

const legacyFailureSummary =
  "A legacy import failed. Historical error details were not retained.";

test(
  "0017 expands and backfills the import job data foundation",
  { timeout: 600_000 },
  async (context) => {
    const harness = await startPostgresTestHarness(
      "pozanuta-import-job-data-foundation-expand",
    );
    const admin = createPostgresTestClient(harness, "postgres");

    try {
      await withBlankPostgresDatabase(
        harness,
        admin,
        "import_job_foundation_main",
        async (sql, database) => {
          await installPostgresCompatibilityFixture(sql);
          await applyPostgresMigrations(sql, 16);
          const seeded = await seedLegacyJobs(sql);

          await applyPostgresMigration(sql, 17);

          await context.test("maps and preserves legacy jobs", async () => {
            assert.deepEqual(await readImportJobStatuses(sql), [
              "queued",
              "running",
              "succeeded",
              "failed",
              "cancelled",
            ]);

            const jobs = [...(await readLegacyJobs(sql))];
            assert.deepEqual(jobs, [
              {
                id: seeded.pendingId,
                source: "ising",
                status: "queued",
                mode: "write",
                initiatorKind: "legacy",
                startedByOperatorId: null,
                totalCount: 5,
                processedCount: 2,
                importedCount: 1,
                skippedCount: 1,
                errorCount: 0,
                safeErrorCode: null,
                safeErrorSummary: null,
                error: null,
                createdAt: "2026-01-01T10:00:00.000Z",
                startedAt: null,
                terminalAt: null,
                updatedAt: "2026-01-01T10:00:00.000Z",
              },
              {
                id: seeded.runningId,
                source: "karafun",
                status: "running",
                mode: "write",
                initiatorKind: "operator",
                startedByOperatorId: seeded.operatorId,
                totalCount: 10,
                processedCount: 5,
                importedCount: 3,
                skippedCount: 2,
                errorCount: 0,
                safeErrorCode: null,
                safeErrorSummary: null,
                error: null,
                createdAt: "2026-01-01T11:00:00.000Z",
                startedAt: "2026-01-01T11:00:00.000Z",
                terminalAt: null,
                updatedAt: "2026-01-01T11:00:00.000Z",
              },
              {
                id: seeded.doneId,
                source: "ising",
                status: "succeeded",
                mode: "write",
                initiatorKind: "operator",
                startedByOperatorId: seeded.operatorId,
                totalCount: 7,
                processedCount: 7,
                importedCount: 5,
                skippedCount: 2,
                errorCount: 0,
                safeErrorCode: null,
                safeErrorSummary: null,
                error: null,
                createdAt: "2026-01-01T12:00:00.000Z",
                startedAt: "2026-01-01T12:00:00.000Z",
                terminalAt: "2026-01-01T13:00:00.000Z",
                updatedAt: "2026-01-01T13:00:00.000Z",
              },
              {
                id: seeded.failedId,
                source: "karafun",
                status: "failed",
                mode: "write",
                initiatorKind: "legacy",
                startedByOperatorId: null,
                totalCount: 8,
                processedCount: 5,
                importedCount: 4,
                skippedCount: 1,
                errorCount: null,
                safeErrorCode: "LEGACY_IMPORT_FAILURE",
                safeErrorSummary: legacyFailureSummary,
                error: null,
                createdAt: "2026-01-01T14:00:00.000Z",
                startedAt: "2026-01-01T14:00:00.000Z",
                terminalAt: "2026-01-01T15:00:00.000Z",
                updatedAt: "2026-01-01T15:00:00.000Z",
              },
            ]);
            assert.equal(JSON.stringify(jobs).includes(seeded.rawSecret), false);
          });

          await context.test(
            "creates retention anchor indexes without implementing cleanup",
            async () => {
              const indexes = await sql<
                Array<{ name: string; definition: string; predicate: string }>
              >`
                SELECT
                  index_class.relname AS name,
                  pg_get_indexdef(pg_index.indexrelid) AS definition,
                  pg_get_expr(pg_index.indpred, pg_index.indrelid) AS predicate
                FROM pg_index
                JOIN pg_class AS index_class
                  ON index_class.oid = pg_index.indexrelid
                JOIN pg_class AS table_class
                  ON table_class.oid = pg_index.indrelid
                JOIN pg_namespace
                  ON pg_namespace.oid = table_class.relnamespace
                WHERE pg_namespace.nspname = 'public'
                  AND table_class.relname = 'import_jobs'
                  AND index_class.relname IN (
                    'import_jobs_terminal_at_idx',
                    'import_jobs_artifact_uploaded_at_idx'
                  )
                ORDER BY index_class.relname
              `;
              assert.deepEqual(
                indexes.map(({ name }) => name),
                [
                  "import_jobs_artifact_uploaded_at_idx",
                  "import_jobs_terminal_at_idx",
                ],
              );
              const artifact = indexes[0];
              const terminal = indexes[1];
              assert.ok(artifact);
              assert.ok(terminal);
              assert.match(artifact.definition, /\(artifact_uploaded_at\)/);
              assert.match(artifact.predicate, /source_artifact_id IS NOT NULL/i);
              assert.match(artifact.predicate, /artifact_deleted_at IS NULL/i);
              assert.match(terminal.definition, /\(finished_at\)/);
              assert.match(terminal.predicate, /succeeded/i);
              assert.match(terminal.predicate, /failed/i);
              assert.match(terminal.predicate, /cancelled/i);
              assert.match(terminal.predicate, /finished_at IS NOT NULL/i);
            },
          );

          await context.test(
            "enforces final statuses and one active job per source",
            async () => {
              for (const legacyStatus of ["pending", "done"]) {
                await assert.rejects(
                  sql.unsafe(
                    `INSERT INTO import_jobs (source, status) VALUES ('ising', '${legacyStatus}'::public.import_job_status)`,
                  ),
                  (error: PgFailure) => error.code === "22P02",
                );
              }

              await assert.rejects(
                sql`
                  INSERT INTO import_jobs (source, status)
                  VALUES ('ising', 'running')
                `,
                (error: PgFailure) =>
                  error.code === "23505" &&
                  error.constraint_name ===
                    "import_jobs_one_active_per_source_idx",
              );

              await sql`
                UPDATE import_jobs
                SET status = 'succeeded', finished_at = '2026-01-02T10:00:00Z'
                WHERE id = ${seeded.pendingId}
              `;
              const [next] = await sql<{ id: number }[]>`
                INSERT INTO import_jobs (source, status)
                VALUES ('ising', 'queued')
                RETURNING id::int AS id
              `;
              assert.ok(next);
              await sql`
                UPDATE import_jobs
                SET status = 'cancelled', finished_at = '2026-01-02T11:00:00Z'
                WHERE id = ${next.id}
              `;
            },
          );

          await context.test(
            "serializes concurrent active jobs per source while allowing different sources",
            async () => {
              const left = createPostgresTestClient(harness, database, 1);
              const right = createPostgresTestClient(harness, database, 1);
              const observer = createPostgresTestClient(harness, database, 1);
              const firstReady = deferred<number>();
              const releaseFirst = deferred<void>();
              let secondAttempt: Promise<number> | undefined;

              const firstAttempt = left
                .begin(async (transaction) => {
                  const [backend] = await transaction<
                    Array<{ backendPid: number }>
                  >`SELECT pg_backend_pid()::int AS "backendPid"`;
                  assert.ok(backend);
                  const [job] = await transaction<Array<{ id: number }>>`
                    INSERT INTO import_jobs (source, status)
                    VALUES ('ising', 'queued')
                    RETURNING id::int AS id
                  `;
                  assert.ok(job);
                  firstReady.resolve(backend.backendPid);
                  await releaseFirst.promise;
                  return job.id;
                })
                .catch((error) => {
                  firstReady.reject(error);
                  throw error;
                });
              void firstAttempt.catch(() => undefined);

              try {
                const blockerPid = await withDeadline(
                  firstReady.promise,
                  5_000,
                  "First active import transaction did not become ready.",
                );
                secondAttempt = right.begin(async (transaction) => {
                  const [job] = await transaction<Array<{ id: number }>>`
                    INSERT INTO import_jobs (source, status)
                    VALUES ('ising', 'running')
                    RETURNING id::int AS id
                  `;
                  assert.ok(job);
                  return job.id;
                });
                void secondAttempt.catch(() => undefined);

                await waitForBlockedByBackend(
                  observer,
                  database,
                  blockerPid,
                );
                releaseFirst.resolve();

                const [firstResult, secondResult] = await Promise.allSettled([
                  firstAttempt,
                  secondAttempt,
                ]);
                assert.equal(firstResult.status, "fulfilled");
                assert.equal(secondResult.status, "rejected");
                if (secondResult.status === "rejected") {
                  const failure = secondResult.reason as PgFailure;
                  assert.equal(failure.code, "23505");
                  assert.equal(
                    failure.constraint_name,
                    "import_jobs_one_active_per_source_idx",
                  );
                }

                const activeBySource = await sql<
                  Array<{ source: string; count: number }>
                >`
                  SELECT source::text AS source, count(*)::int AS count
                  FROM import_jobs
                  WHERE status IN ('queued', 'running')
                    AND source IN ('ising', 'karafun')
                  GROUP BY source
                  ORDER BY source::text
                `;
                assert.deepEqual([...activeBySource], [
                  { source: "ising", count: 1 },
                  { source: "karafun", count: 1 },
                ]);

                await sql`
                  UPDATE import_jobs
                  SET
                    status = 'succeeded',
                    finished_at = '2026-01-02T11:30:00Z'
                  WHERE source = 'ising'
                    AND status IN ('queued', 'running')
                `;
              } finally {
                releaseFirst.resolve();
                await Promise.allSettled([
                  firstAttempt,
                  secondAttempt ?? Promise.resolve(0),
                ]);
                await observer.end({ timeout: 5 });
                await right.end({ timeout: 5 });
                await left.end({ timeout: 5 });
              }
            },
          );

          await context.test(
            "enforces expand-only counter, error and artifact checks",
            async () => {
              await assertCheckViolation(
                sql`
                  INSERT INTO import_jobs (
                    source, status, processed_count, error_count
                  ) VALUES ('ising', 'succeeded', -1, 0)
                `,
                "import_jobs_expand_counts_check",
              );
              await assertCheckViolation(
                sql`
                  INSERT INTO import_jobs (
                    source, status, safe_error_code
                  ) VALUES ('ising', 'failed', 'IMPORT_FAILED')
                `,
                "import_jobs_safe_error_pair_check",
              );
              await assertCheckViolation(
                sql`
                  INSERT INTO import_jobs (
                    source, status, source_artifact_id
                  ) VALUES (
                    'karafun',
                    'failed',
                    '11111111-1111-4111-8111-111111111111'
                  )
                `,
                "import_jobs_artifact_state_check",
              );
              await assertCheckViolation(
                sql`
                  INSERT INTO import_jobs (
                    source,
                    status,
                    source_artifact_id,
                    artifact_uploaded_at,
                    artifact_deleted_at
                  ) VALUES (
                    'karafun',
                    'failed',
                    '22222222-2222-4222-8222-222222222222',
                    '2026-01-02T12:00:00Z',
                    '2026-01-02T11:00:00Z'
                  )
                `,
                "import_jobs_artifact_state_check",
              );
            },
          );

          await context.test(
            "keeps Ticket 11A writes compatible only for the paused deployment window",
            async () => {
              const [legacyWindowJob] = await sql<{ id: number }[]>`
                INSERT INTO import_jobs (
                  source,
                  status,
                  total_rows,
                  imported_count,
                  skipped_count
                ) VALUES ('ising', 'running', 0, 0, 0)
                RETURNING id::int AS id
              `;
              assert.ok(legacyWindowJob);

              await sql`
                UPDATE import_jobs
                SET
                  status = 'failed',
                  error = 'IMPORT_FAILED',
                  finished_at = '2026-01-02T12:00:00Z'
                WHERE id = ${legacyWindowJob.id}
              `;
              const [transitional] = await sql<
                Array<{
                  mode: string;
                  initiatorKind: string;
                  startedAt: string | null;
                  processedCount: number | null;
                  errorCount: number | null;
                  safeErrorCode: string | null;
                  legacyError: string | null;
                }>
              >`
                SELECT
                  mode::text AS mode,
                  initiator_kind::text AS "initiatorKind",
                  started_at::text AS "startedAt",
                  processed_count AS "processedCount",
                  error_count AS "errorCount",
                  safe_error_code AS "safeErrorCode",
                  error AS "legacyError"
                FROM import_jobs
                WHERE id = ${legacyWindowJob.id}
              `;
              assert.deepEqual(transitional, {
                mode: "write",
                initiatorKind: "system",
                startedAt: null,
                processedCount: null,
                errorCount: null,
                safeErrorCode: null,
                legacyError: "IMPORT_FAILED",
              });
              await sql`DELETE FROM import_jobs WHERE id = ${legacyWindowJob.id}`;
            },
          );

          await context.test(
            "stores bounded safe diagnostics and cascades them with the job",
            async () => {
              const [diagnostic] = await sql<{ id: number }[]>`
                INSERT INTO import_job_diagnostics (
                  import_job_id, code, safe_summary
                ) VALUES (
                  ${seeded.doneId},
                  'ROW_SKIPPED',
                  'A row was skipped after safe validation.'
                )
                RETURNING id::int AS id
              `;
              assert.ok(diagnostic);

              await assertCheckViolation(
                sql`
                  INSERT INTO import_job_diagnostics (
                    import_job_id, code, safe_summary
                  ) VALUES (${seeded.doneId}, 'bad code', 'Safe summary.')
                `,
                "import_job_diagnostics_code_check",
              );
              await assert.rejects(
                sql`
                  INSERT INTO import_job_diagnostics (
                    import_job_id, code, safe_summary
                  ) VALUES (999999, 'ROW_SKIPPED', 'Safe summary.')
                `,
                (error: PgFailure) => error.code === "23503",
              );

              const [security] = await sql<
                Array<{ rlsEnabled: boolean; policyCount: number }>
              >`
                SELECT
                  pg_class.relrowsecurity AS "rlsEnabled",
                  (
                    SELECT count(*)::int
                    FROM pg_policies
                    WHERE schemaname = 'public'
                      AND tablename = 'import_job_diagnostics'
                  ) AS "policyCount"
                FROM pg_class
                JOIN pg_namespace
                  ON pg_namespace.oid = pg_class.relnamespace
                WHERE pg_namespace.nspname = 'public'
                  AND pg_class.relname = 'import_job_diagnostics'
              `;
              assert.deepEqual(security, {
                rlsEnabled: true,
                policyCount: 0,
              });

              await sql.unsafe(
                "GRANT USAGE ON SCHEMA public TO anon, authenticated",
              );
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
                    SELECT id
                    FROM import_job_diagnostics
                    WHERE id = ${diagnostic.id}
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
                        ${seeded.doneId},
                        'BROWSER_WRITE',
                        'Browser roles must not persist diagnostics.'
                      )
                    `;
                  }),
                  (error: PgFailure) => error.code === "42501",
                );
              }

              const [ownerVisible] = await sql<{ count: number }[]>`
                SELECT count(*)::int AS count
                FROM import_job_diagnostics
                WHERE id = ${diagnostic.id}
              `;
              assert.equal(ownerVisible?.count, 1);

              await sql`DELETE FROM import_jobs WHERE id = ${seeded.doneId}`;
              const [remaining] = await sql<{ count: number }[]>`
                SELECT count(*)::int AS count
                FROM import_job_diagnostics
                WHERE id = ${diagnostic.id}
              `;
              assert.equal(remaining?.count, 0);
            },
          );

          await context.test(
            "production iSing writer keeps lifecycle timestamps monotonic across clock skew",
            async () => {
              const database = drizzle({ client: sql });
              const startedAt = new Date("2026-01-03T09:00:00.000Z");
              const successId = await createISingImportJob(database, startedAt);

              assert.deepEqual(await readWriterJob(sql, successId), {
                status: "running",
                mode: "write",
                initiatorKind: "system",
                startedByOperatorId: null,
                totalCount: 0,
                processedCount: 0,
                importedCount: 0,
                skippedCount: 0,
                errorCount: 0,
                safeErrorCode: null,
                safeErrorSummary: null,
                error: null,
                createdAt: startedAt.toISOString(),
                startedAt: startedAt.toISOString(),
                terminalAt: null,
                updatedAt: startedAt.toISOString(),
                sourceArtifactId: null,
                artifactUploadedAt: null,
                artifactDeletedAt: null,
              });

              const skewedSuccessAt = new Date("2026-01-03T08:59:59.000Z");
              await markISingImportJobSucceeded(
                database,
                successId,
                {
                  processed: 7,
                  inserted: 3,
                  updated: 2,
                  skipped: 2,
                  errors: 0,
                  pages: 1,
                  dryRun: false,
                },
                skewedSuccessAt,
              );
              const succeeded = await readWriterJob(sql, successId);
              assert.deepEqual(succeeded, {
                status: "succeeded",
                mode: "write",
                initiatorKind: "system",
                startedByOperatorId: null,
                totalCount: 7,
                processedCount: 7,
                importedCount: 5,
                skippedCount: 2,
                errorCount: 0,
                safeErrorCode: null,
                safeErrorSummary: null,
                error: null,
                createdAt: startedAt.toISOString(),
                startedAt: startedAt.toISOString(),
                terminalAt: startedAt.toISOString(),
                updatedAt: startedAt.toISOString(),
                sourceArtifactId: null,
                artifactUploadedAt: null,
                artifactDeletedAt: null,
              });

              const failedStartedAt = new Date("2026-01-03T10:00:00.000Z");
              const failedId = await createISingImportJob(
                database,
                failedStartedAt,
              );
              const skewedFailureAt = new Date("2026-01-03T09:59:59.000Z");
              const secret = "test-only-import-secret";
              const originalError = new Error(`upstream failed with ${secret}`);

              await assert.rejects(
                async () => {
                  try {
                    throw originalError;
                  } catch (error) {
                    await markISingImportJobFailed(
                      database,
                      failedId,
                      skewedFailureAt,
                    );
                    throw error;
                  }
                },
                (error: unknown) => error === originalError,
              );

              const failed = await readWriterJob(sql, failedId);
              assert.deepEqual(failed, {
                status: "failed",
                mode: "write",
                initiatorKind: "system",
                startedByOperatorId: null,
                totalCount: 0,
                processedCount: 0,
                importedCount: 0,
                skippedCount: 0,
                errorCount: 0,
                safeErrorCode: ISING_IMPORT_FAILURE_ERROR,
                safeErrorSummary: ISING_IMPORT_FAILURE_SUMMARY,
                error: null,
                createdAt: failedStartedAt.toISOString(),
                startedAt: failedStartedAt.toISOString(),
                terminalAt: failedStartedAt.toISOString(),
                updatedAt: failedStartedAt.toISOString(),
                sourceArtifactId: null,
                artifactUploadedAt: null,
                artifactDeletedAt: null,
              });
              assert.equal(JSON.stringify(failed).includes(secret), false);
            },
          );
        },
      );

      await withBlankPostgresDatabase(
        harness,
        admin,
        "import_job_foundation_missing_terminal",
        async (sql) => {
          await installPostgresCompatibilityFixture(sql);
          await applyPostgresMigrations(sql, 16);
          await sql`
            INSERT INTO import_jobs (source, status, finished_at)
            VALUES ('ising', 'done', NULL)
          `;

          await assert.rejects(
            applyPostgresMigration(sql, 17),
            (error: PgFailure) =>
              error.code === "23514" &&
              error.constraint_name ===
                "import_jobs_terminal_timestamp_required",
          );
        },
      );

      await withBlankPostgresDatabase(
        harness,
        admin,
        "import_job_foundation_duplicate_active",
        async (sql) => {
          await installPostgresCompatibilityFixture(sql);
          await applyPostgresMigrations(sql, 16);
          await sql`
            INSERT INTO import_jobs (source, status)
            VALUES ('ising', 'pending'), ('ising', 'running')
          `;

          await assert.rejects(
            applyPostgresMigration(sql, 17),
            (error: PgFailure) =>
              error.code === "23505" &&
              error.constraint_name ===
                "import_jobs_one_active_per_source_idx",
          );
        },
      );

      await withBlankPostgresDatabase(
        harness,
        admin,
        "import_job_foundation_invalid_counts",
        async (sql) => {
          await installPostgresCompatibilityFixture(sql);
          await applyPostgresMigrations(sql, 16);
          await sql`
            INSERT INTO import_jobs (
              source, status, total_rows, imported_count, skipped_count
            ) VALUES ('ising', 'done', 1, 1, 1)
          `;
          await sql`
            UPDATE import_jobs
            SET finished_at = '2026-01-04T10:00:00Z'
          `;

          await assert.rejects(
            applyPostgresMigration(sql, 17),
            (error: PgFailure) =>
              error.code === "23514" &&
              error.constraint_name === "import_jobs_expand_counts_check",
          );
        },
      );
    } finally {
      await admin.end({ timeout: 5 });
      await removePostgresTestHarness(harness.containerName);
    }

    assert.equal(
      await postgresTestContainerExists(harness.containerName),
      false,
      "Import job foundation test container must be removed",
    );
  },
);

async function seedLegacyJobs(sql: SqlExecutor) {
  const rawSecret = "legacy-raw-error-with-test-secret";
  const [operator] = await sql<{ id: number }[]>`
    INSERT INTO operator_users (name, password_hash)
    VALUES ('Import Operator', 'not-used-by-test')
    RETURNING id::int AS id
  `;
  assert.ok(operator);

  const rows = await sql<{ id: number; status: string }[]>`
    INSERT INTO import_jobs (
      source,
      status,
      started_by_operator_id,
      total_rows,
      imported_count,
      skipped_count,
      error,
      created_at,
      finished_at
    ) VALUES
      ('ising', 'pending', NULL, 5, 1, 1, NULL, '2026-01-01T10:00:00Z', NULL),
      ('karafun', 'running', ${operator.id}, 10, 3, 2, NULL, '2026-01-01T11:00:00Z', NULL),
      ('ising', 'done', ${operator.id}, 7, 5, 2, NULL, '2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z'),
      ('karafun', 'failed', NULL, 8, 4, 1, ${rawSecret}, '2026-01-01T14:00:00Z', '2026-01-01T15:00:00Z')
    RETURNING id::int AS id, status::text AS status
  `;
  const byStatus = new Map(rows.map((row) => [row.status, row.id]));

  return {
    operatorId: operator.id,
    pendingId: requiredId(byStatus, "pending"),
    runningId: requiredId(byStatus, "running"),
    doneId: requiredId(byStatus, "done"),
    failedId: requiredId(byStatus, "failed"),
    rawSecret,
  };
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
  return rows.map((row) => row.value);
}

async function readLegacyJobs(sql: SqlExecutor) {
  return sql`
    SELECT
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
      error,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      CASE WHEN started_at IS NULL THEN NULL ELSE to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "startedAt",
      CASE WHEN finished_at IS NULL THEN NULL ELSE to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "terminalAt",
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
    FROM import_jobs
    ORDER BY id
  `;
}

async function readWriterJob(sql: SqlExecutor, jobId: number) {
  const [job] = await sql`
    SELECT
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
      error,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startedAt",
      CASE WHEN finished_at IS NULL THEN NULL ELSE to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "terminalAt",
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt",
      source_artifact_id::text AS "sourceArtifactId",
      artifact_uploaded_at::text AS "artifactUploadedAt",
      artifact_deleted_at::text AS "artifactDeletedAt"
    FROM import_jobs
    WHERE id = ${jobId}
  `;
  assert.ok(job);
  return job;
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

function requiredId(rows: Map<string, number>, status: string) {
  const id = rows.get(status);
  assert.ok(id);
  return id;
}

async function waitForBlockedByBackend(
  observer: SqlExecutor,
  database: string,
  backendPid: number,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await observer.unsafe(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_stat_activity AS waiting
         WHERE waiting.pid <> $1
           AND $1 = ANY(pg_blocking_pids(waiting.pid))
           AND waiting.datname = $2
           AND waiting.wait_event_type = 'Lock'
       ) AS "blocked"`,
      [backendPid, database],
    );
    if (rows[0]?.blocked === true) return;
    await delay(10);
  }
  assert.fail("Concurrent import insert did not wait on the active-source index.");
}

async function withDeadline<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function delay(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
