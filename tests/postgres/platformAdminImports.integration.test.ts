import assert from "node:assert/strict";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../../src/db/schema.ts";
import { readRecentImportJobs } from "../../src/server/platform-admin/import-admin-store.ts";
import {
  applyPostgresMigrations,
  createPostgresDatabase,
  createPostgresTestClient,
  dropPostgresDatabase,
  installPostgresCompatibilityFixture,
  postgresDatabaseName,
  postgresTestContainerExists,
  removePostgresTestHarness,
  startPostgresTestHarness,
} from "./postgresTestHarness.ts";

const images = ["postgres:15-alpine", "postgres:17-alpine"] as const;

test(
  "platform admin imports reads a bounded safe projection on PostgreSQL 15 and 17",
  { timeout: 1_200_000 },
  async (context) => {
    for (const image of images) {
      await context.test(image, async () => verifyOnImage(image));
    }
  },
);

async function verifyOnImage(image: (typeof images)[number]) {
  const version = image.startsWith("postgres:15") ? "15" : "17";
  const harness = await startPostgresTestHarness(
    `pozanuta-platform-admin-imports-pg${version}`,
    image,
  );
  const admin = createPostgresTestClient(harness, "postgres");
  const databaseName = postgresDatabaseName(`platform_admin_imports_pg${version}`);

  try {
    await createPostgresDatabase(admin, databaseName);
    const sql = createPostgresTestClient(harness, databaseName);

    try {
      await installPostgresCompatibilityFixture(sql);
      await applyPostgresMigrations(sql, 19);
      await seedImportJobs(sql);

      const database = drizzle({ client: sql, schema });
      const rows = await readRecentImportJobs(database, 2);

      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.map((row) => row.source),
        ["karafun", "ising"],
      );
      assert.deepEqual(Object.keys(rows[0] ?? {}).sort(), [
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
      assert.doesNotMatch(
        JSON.stringify(rows),
        /claimToken|leaseExpiresAt|heartbeatAt|rawError|databaseUrl/i,
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  } finally {
    await dropPostgresDatabase(admin, databaseName);
    await admin.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }

  assert.equal(await postgresTestContainerExists(harness.containerName), false);
}

async function seedImportJobs(
  sql: ReturnType<typeof createPostgresTestClient>,
) {
  await sql`
    INSERT INTO import_jobs (
      source, status, mode, initiator_kind,
      total_rows, processed_count, imported_count, skipped_count, error_count,
      safe_error_code, safe_error_summary,
      created_at, started_at, finished_at, updated_at, attempt_count
    ) VALUES
      (
        'ising', 'succeeded', 'dry_run', 'system',
        4, 4, 0, 4, 0, NULL, NULL,
        '2026-07-17T10:00:00Z', '2026-07-17T10:01:00Z',
        '2026-07-17T10:02:00Z', '2026-07-17T10:03:00Z', 1
      ),
      (
        'ising', 'failed', 'write', 'system',
        3, 2, 1, 0, 1, 'IMPORT_FAILED', 'Import failed safely.',
        '2026-07-17T11:00:00Z', '2026-07-17T11:01:00Z',
        '2026-07-17T11:02:00Z', '2026-07-17T11:03:00Z', 1
      ),
      (
        'karafun', 'cancelled', 'validate', 'legacy',
        0, 0, 0, 0, 0, NULL, NULL,
        '2026-07-17T12:00:00Z', NULL,
        '2026-07-17T12:01:00Z', '2026-07-17T12:02:00Z', 0
      )
  `;
}
