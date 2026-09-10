import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "drizzle/0017_import_job_data_foundation_expand.sql";
const previousSnapshotPath = "drizzle/meta/0016_snapshot.json";
const snapshotPath = "drizzle/meta/0017_snapshot.json";

type SnapshotTable = {
  columns: Record<string, unknown>;
  indexes: Record<string, unknown>;
  foreignKeys: Record<string, unknown>;
  policies: Record<string, unknown>;
  checkConstraints: Record<string, unknown>;
  isRLSEnabled: boolean;
};

type Snapshot = {
  id: string;
  prevId: string;
  tables: Record<string, SnapshotTable>;
  enums: Record<string, { values: string[] }>;
};

type Journal = {
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
};

const addedImportJobColumns = [
  "mode",
  "initiator_kind",
  "processed_count",
  "error_count",
  "safe_error_code",
  "safe_error_summary",
  "started_at",
  "updated_at",
  "cancellation_requested_at",
  "cancellation_requested_by_operator_id",
  "source_artifact_id",
  "artifact_uploaded_at",
  "artifact_deleted_at",
] as const;

test("0017 performs guarded expand backfill and controlled status replacement", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const preflightPosition = migration.indexOf("DO $$");
  const firstSchemaChangePosition = migration.indexOf(
    'CREATE TYPE "public"."import_job_mode"',
  );

  assert.match(
    migration,
    /LOCK TABLE "public"\."import_jobs" IN SHARE ROW EXCLUSIVE MODE/,
  );
  assert.ok(preflightPosition >= 0);
  assert.ok(firstSchemaChangePosition > preflightPosition);
  assert.match(migration, /import_jobs_terminal_timestamp_required/);
  assert.match(migration, /import_jobs_one_active_per_source_idx/);
  assert.match(
    migration,
    /"imported_count" \+ "skipped_count" > "total_rows"/,
  );
  assert.match(migration, /WHEN 'pending' THEN 'queued'/);
  assert.match(migration, /WHEN 'done' THEN 'succeeded'/);
  assert.match(migration, /DROP TYPE "public"\."import_job_status"/);
  assert.match(
    migration,
    /CREATE TYPE "public"\."import_job_status_0017" AS ENUM\('queued', 'running', 'succeeded', 'failed', 'cancelled'\)/,
  );
  assert.match(
    migration,
    /"processed_count" = "imported_count" \+ "skipped_count"/,
  );
  assert.match(
    migration,
    /WHEN "status"::text = 'failed' THEN NULL\s+ELSE 0/,
  );
  assert.match(migration, /LEGACY_IMPORT_FAILURE/);
  assert.match(migration, /SET "error" = NULL/);
  assert.match(
    migration,
    /CREATE INDEX "import_jobs_terminal_at_idx"[\s\S]*?ON "public"\."import_jobs" USING btree \("finished_at"\)[\s\S]*?WHERE "status" IN \('succeeded', 'failed', 'cancelled'\)[\s\S]*?AND "finished_at" IS NOT NULL/,
  );
  assert.match(
    migration,
    /CREATE INDEX "import_jobs_artifact_uploaded_at_idx"[\s\S]*?ON "public"\."import_jobs" USING btree \("artifact_uploaded_at"\)[\s\S]*?WHERE "source_artifact_id" IS NOT NULL[\s\S]*?AND "artifact_deleted_at" IS NULL/,
  );
  assert.match(
    migration,
    /ALTER TABLE "public"\."import_job_diagnostics" ENABLE ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(migration, /CREATE\s+POLICY/i);
  assert.doesNotMatch(
    migration,
    /"safe_error_(?:code|summary)"\s*=\s*"error"/,
  );
  assert.doesNotMatch(migration, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i);
  assert.doesNotMatch(migration, /CREATE\s+TRIGGER/i);
});

test("0017 snapshot changes only the import job foundation", () => {
  const previous = JSON.parse(
    readFileSync(previousSnapshotPath, "utf8"),
  ) as Snapshot;
  const next = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;

  assert.equal(next.prevId, previous.id);
  assert.deepEqual(next.enums["public.import_job_status"]?.values, [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
  ]);
  assert.deepEqual(next.enums["public.import_job_mode"]?.values, [
    "validate",
    "dry_run",
    "write",
  ]);
  assert.deepEqual(next.enums["public.import_job_initiator_kind"]?.values, [
    "operator",
    "system",
    "legacy",
  ]);

  const previousOtherTables = structuredClone(previous.tables);
  const nextOtherTables = structuredClone(next.tables);
  delete previousOtherTables["public.import_jobs"];
  delete nextOtherTables["public.import_jobs"];
  delete nextOtherTables["public.import_job_diagnostics"];
  assert.deepEqual(nextOtherTables, previousOtherTables);

  const previousOtherEnums = structuredClone(previous.enums);
  const nextOtherEnums = structuredClone(next.enums);
  delete previousOtherEnums["public.import_job_status"];
  delete nextOtherEnums["public.import_job_status"];
  delete nextOtherEnums["public.import_job_mode"];
  delete nextOtherEnums["public.import_job_initiator_kind"];
  assert.deepEqual(nextOtherEnums, previousOtherEnums);

  const previousImportJobs = previous.tables["public.import_jobs"];
  const nextImportJobs = structuredClone(next.tables["public.import_jobs"]);
  assert.ok(previousImportJobs);
  assert.ok(nextImportJobs);

  for (const column of addedImportJobColumns) {
    assert.ok(nextImportJobs.columns[column], `Missing ${column}`);
    delete nextImportJobs.columns[column];
  }
  const terminalIndex = nextImportJobs.indexes.import_jobs_terminal_at_idx as {
    columns: Array<{ expression: string }>;
    isUnique: boolean;
    where: string;
  };
  assert.deepEqual(
    terminalIndex.columns.map(({ expression }) => expression),
    ["finished_at"],
  );
  assert.equal(terminalIndex.isUnique, false);
  assert.equal(
    terminalIndex.where,
    '"import_jobs"."status" in (\'succeeded\', \'failed\', \'cancelled\') and "import_jobs"."finished_at" is not null',
  );
  const artifactIndex = nextImportJobs.indexes
    .import_jobs_artifact_uploaded_at_idx as {
    columns: Array<{ expression: string }>;
    isUnique: boolean;
    where: string;
  };
  assert.deepEqual(
    artifactIndex.columns.map(({ expression }) => expression),
    ["artifact_uploaded_at"],
  );
  assert.equal(artifactIndex.isUnique, false);
  assert.equal(
    artifactIndex.where,
    '"import_jobs"."source_artifact_id" is not null and "import_jobs"."artifact_deleted_at" is null',
  );
  delete nextImportJobs.indexes.import_jobs_cancellation_requested_by_operator_idx;
  delete nextImportJobs.indexes.import_jobs_terminal_at_idx;
  delete nextImportJobs.indexes.import_jobs_artifact_uploaded_at_idx;
  delete nextImportJobs.indexes.import_jobs_one_active_per_source_idx;
  delete nextImportJobs.foreignKeys
    .import_jobs_cancellation_requested_by_operator_id_operator_users_id_fk;
  delete nextImportJobs.checkConstraints.import_jobs_expand_counts_check;
  delete nextImportJobs.checkConstraints.import_jobs_safe_error_pair_check;
  delete nextImportJobs.checkConstraints.import_jobs_artifact_state_check;
  delete nextImportJobs.checkConstraints.import_jobs_cancellation_request_check;
  const nextStatus = nextImportJobs.columns.status as { default?: string };
  const previousStatus = previousImportJobs.columns.status as {
    default?: string;
  };
  nextStatus.default = previousStatus.default;
  assert.deepEqual(nextImportJobs, previousImportJobs);

  const diagnostics = next.tables["public.import_job_diagnostics"];
  assert.ok(diagnostics);
  assert.deepEqual(Object.keys(diagnostics.columns), [
    "id",
    "import_job_id",
    "code",
    "safe_summary",
    "recorded_at",
  ]);
  assert.deepEqual(Object.keys(diagnostics.foreignKeys), [
    "import_job_diagnostics_import_job_id_import_jobs_id_fk",
  ]);
  assert.deepEqual(Object.keys(diagnostics.indexes), [
    "import_job_diagnostics_job_recorded_at_idx",
    "import_job_diagnostics_recorded_at_idx",
  ]);
  assert.equal(diagnostics.isRLSEnabled, true);
  assert.deepEqual(diagnostics.policies, {});
});

test("0017 follows 0016 in the migration journal", () => {
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as Journal;
  const previous = journal.entries.find(({ idx }) => idx === 16);
  const current = journal.entries.find(({ idx }) => idx === 17);

  assert.equal(previous?.idx, 16);
  assert.equal(previous?.tag, "0016_import_job_status_expand");
  assert.deepEqual(current, {
    idx: 17,
    version: "7",
    when: current?.when,
    tag: "0017_import_job_data_foundation_expand",
    breakpoints: true,
  });
});
