import assert from "node:assert/strict";
import test from "node:test";

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
  type SqlExecutor,
} from "./postgresTestHarness.ts";

const legacyStatuses = ["pending", "running", "done", "failed"] as const;
const expandedStatuses = ["queued", "succeeded", "cancelled"] as const;

type PgFailure = Error & { code?: string };

test(
  "0016 expands import job statuses without changing import_jobs structure or data",
  { timeout: 600_000 },
  async () => {
    const harness = await startPostgresTestHarness(
      "pozanuta-import-job-status-expansion",
    );
    const admin = createPostgresTestClient(harness, "postgres");
    const database = postgresDatabaseName("import_job_status_expansion");

    try {
      await createPostgresDatabase(admin, database);
      const sql = createPostgresTestClient(harness, database);

      try {
        await installPostgresCompatibilityFixture(sql);
        await applyPostgresMigrations(sql, 15);

        for (const status of legacyStatuses) {
          await insertImportJob(sql, status);
        }
        for (const status of expandedStatuses) {
          await assert.rejects(
            insertImportJob(sql, status),
            (error: PgFailure) => error.code === "22P02",
          );
        }

        const definitionBefore = await readImportJobsDefinition(sql);
        const rowsBefore = await readImportJobs(sql);

        await applyPostgresMigration(sql, 16);

        assert.deepEqual(
          await readImportJobsDefinition(sql),
          definitionBefore,
        );
        assert.deepEqual(await readImportJobs(sql), rowsBefore);

        for (const status of [...legacyStatuses, ...expandedStatuses]) {
          await insertImportJob(sql, status);
        }

        const statuses = await sql<{ status: string }[]>`
          SELECT DISTINCT status::text AS status
          FROM import_jobs
          ORDER BY status::text
        `;
        assert.deepEqual(
          statuses.map(({ status }) => status).sort(),
          [...legacyStatuses, ...expandedStatuses].sort(),
        );

      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await dropPostgresDatabase(admin, database);
      await admin.end({ timeout: 5 });
      await removePostgresTestHarness(harness.containerName);
    }

    assert.equal(
      await postgresTestContainerExists(harness.containerName),
      false,
      "Import job status expansion test container must be removed",
    );
  },
);

async function insertImportJob(sql: SqlExecutor, status: string) {
  await sql`
    INSERT INTO import_jobs (source, status)
    VALUES ('ising', ${status}::"public"."import_job_status")
  `;
}

async function readImportJobs(sql: SqlExecutor) {
  return sql`
    SELECT
      id::text,
      source::text,
      status::text,
      started_by_operator_id::text,
      total_rows,
      imported_count,
      skipped_count,
      error,
      created_at::text,
      finished_at::text
    FROM import_jobs
    ORDER BY id
  `;
}

async function readImportJobsDefinition(sql: SqlExecutor) {
  return sql`
    SELECT jsonb_build_object(
      'columns', (
        SELECT jsonb_agg(to_jsonb(columns) ORDER BY ordinal_position)
        FROM (
          SELECT
            ordinal_position,
            column_name,
            data_type,
            udt_schema,
            udt_name,
            is_nullable,
            column_default,
            is_identity
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'import_jobs'
        ) AS columns
      ),
      'constraints', (
        SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname)
        FROM pg_constraint
        WHERE conrelid = 'public.import_jobs'::regclass
      ),
      'indexes', (
        SELECT jsonb_agg(indexdef ORDER BY indexname)
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'import_jobs'
      )
    ) AS definition
  `;
}
