import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "drizzle/0018_import_job_data_foundation_contract.sql";
const previousSnapshotPath = "drizzle/meta/0017_snapshot.json";
const snapshotPath = "drizzle/meta/0018_snapshot.json";

type SnapshotTable = {
  columns: Record<string, Record<string, unknown>>;
  indexes: Record<string, unknown>;
  foreignKeys: Record<string, Record<string, unknown>>;
  policies: Record<string, unknown>;
  checkConstraints: Record<string, { name: string; value: string }>;
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

const finalChecks = [
  "import_jobs_artifact_state_check",
  "import_jobs_cancellation_request_check",
  "import_jobs_counts_check",
  "import_jobs_initiator_check",
  "import_jobs_lifecycle_check",
  "import_jobs_progress_check",
  "import_jobs_safe_error_check",
  "import_jobs_timestamp_order_check",
] as const;

test("0018 performs every contract preflight before schema changes", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const preflightPosition = migration.indexOf("DO $$");
  const firstSchemaChangePosition = migration.indexOf(
    "INTO STRICT existing_constraint_name",
  );

  assert.match(
    migration,
    /LOCK TABLE "public"\."import_jobs" IN SHARE ROW EXCLUSIVE MODE/,
  );
  assert.ok(preflightPosition >= 0);
  assert.ok(firstSchemaChangePosition > preflightPosition);
  assert.match(
    migration,
    /array_agg\(e\.enumlabel::text ORDER BY e\.enumsortorder\)[\s\S]*?ARRAY\[\s*'queued',\s*'running',\s*'succeeded',\s*'failed',\s*'cancelled'\s*\]::text\[\]/,
  );

  for (const identifier of [
    "import_jobs_status_contract",
    "import_jobs_lifecycle_check",
    "import_jobs_timestamp_order_check",
    "import_jobs_initiator_check",
    "import_jobs_progress_check",
    "import_jobs_safe_error_check",
    "import_jobs_legacy_error_empty",
    "import_jobs_cancellation_request_check",
    "import_jobs_artifact_state_check",
    "import_jobs_one_active_per_source_idx",
    "import_jobs_index_contract",
    "import_jobs_started_by_operator_fk_source",
    "import_jobs_cancel_requested_by_operator_fk_source",
  ]) {
    const position = migration.indexOf(identifier);
    assert.ok(position >= 0, `Missing preflight ${identifier}`);
    assert.ok(position < firstSchemaChangePosition, `${identifier} runs after DDL`);
  }

  assert.match(migration, /c\.conkey = ARRAY\[/);
  assert.match(migration, /c\.confkey = ARRAY\[/);
  assert.match(migration, /c\.confdeltype::text/);
  assert.equal(migration.match(/AND i\.indisvalid/g)?.length, 4);
  assert.equal(migration.match(/AND i\.indisready/g)?.length, 4);
  assert.match(migration, /EXECUTE format\([\s\S]*?DROP CONSTRAINT %I/);
  assert.doesNotMatch(
    migration,
    /DROP CONSTRAINT "import_jobs_cancellation_requested_by_operator_id_operator_users_id_fk"/,
  );
  assert.doesNotMatch(
    migration,
    /^\s*(?:INSERT INTO|UPDATE\s+"public"|DELETE FROM)\b/im,
  );
  assert.doesNotMatch(migration, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i);
  assert.doesNotMatch(migration, /CREATE\s+TRIGGER/i);
  assert.doesNotMatch(migration, /CREATE\s+POLICY/i);
});

test("0018 finalizes only the accepted import job contract", () => {
  const migration = readFileSync(migrationPath, "utf8");

  assert.match(
    migration,
    /ALTER COLUMN "processed_count" SET NOT NULL/,
  );
  for (const column of ["status", "mode", "initiator_kind", "updated_at"]) {
    assert.match(
      migration,
      new RegExp(`ALTER COLUMN "${column}" DROP DEFAULT`),
    );
  }
  assert.doesNotMatch(
    migration,
    /ALTER COLUMN "created_at" DROP DEFAULT/,
  );
  assert.match(migration, /DROP COLUMN "error"/);
  assert.match(
    migration,
    /CONSTRAINT "import_jobs_started_by_operator_fk"[\s\S]*?ON DELETE RESTRICT[\s\S]*?ON UPDATE NO ACTION/,
  );
  assert.match(
    migration,
    /CONSTRAINT "import_jobs_cancel_requested_by_operator_fk"[\s\S]*?ON DELETE SET NULL[\s\S]*?ON UPDATE NO ACTION/,
  );
  assert.match(
    migration,
    /"processed_count" = "imported_count" \+ "skipped_count" \+ COALESCE\("error_count", 0\)/,
  );
  assert.match(
    migration,
    /"error_count" IS NULL[\s\S]*?"initiator_kind" = 'legacy'[\s\S]*?"status" = 'failed'/,
  );
  assert.match(
    migration,
    /"status" = 'cancelled' AND "finished_at" IS NOT NULL/,
  );
  assert.match(
    migration,
    /"started_at" IS NULL OR "updated_at" >= "started_at"/,
  );
  assert.match(
    migration,
    /"finished_at" IS NULL OR "updated_at" >= "finished_at"/,
  );
});

test("0018 snapshot differs from 0017 only by the import_jobs contract", () => {
  const previous = JSON.parse(
    readFileSync(previousSnapshotPath, "utf8"),
  ) as Snapshot;
  const next = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;

  assert.equal(next.prevId, previous.id);
  assert.deepEqual(next.enums, previous.enums);

  const previousOtherTables = structuredClone(previous.tables);
  const nextOtherTables = structuredClone(next.tables);
  delete previousOtherTables["public.import_jobs"];
  delete nextOtherTables["public.import_jobs"];
  assert.deepEqual(nextOtherTables, previousOtherTables);

  const previousImportJobs = structuredClone(
    previous.tables["public.import_jobs"],
  );
  const nextImportJobs = next.tables["public.import_jobs"];
  assert.ok(previousImportJobs);
  assert.ok(nextImportJobs);

  assert.equal(nextImportJobs.columns.error, undefined);
  assert.equal(nextImportJobs.columns.processed_count?.notNull, true);
  assert.equal(nextImportJobs.columns.created_at?.default, "now()");
  for (const column of ["status", "mode", "initiator_kind", "updated_at"]) {
    assert.equal(nextImportJobs.columns[column]?.default, undefined);
  }
  assert.deepEqual(
    Object.keys(nextImportJobs.foreignKeys).sort(),
    [
      "import_jobs_cancel_requested_by_operator_fk",
      "import_jobs_started_by_operator_fk",
    ],
  );
  assert.deepEqual(
    nextImportJobs.foreignKeys.import_jobs_started_by_operator_fk,
    {
      name: "import_jobs_started_by_operator_fk",
      tableFrom: "import_jobs",
      tableTo: "operator_users",
      columnsFrom: ["started_by_operator_id"],
      columnsTo: ["id"],
      onDelete: "restrict",
      onUpdate: "no action",
    },
  );
  assert.deepEqual(
    nextImportJobs.foreignKeys.import_jobs_cancel_requested_by_operator_fk,
    {
      name: "import_jobs_cancel_requested_by_operator_fk",
      tableFrom: "import_jobs",
      tableTo: "operator_users",
      columnsFrom: ["cancellation_requested_by_operator_id"],
      columnsTo: ["id"],
      onDelete: "set null",
      onUpdate: "no action",
    },
  );
  assert.deepEqual(
    Object.keys(nextImportJobs.checkConstraints).sort(),
    [...finalChecks].sort(),
  );
  assert.match(
    nextImportJobs.checkConstraints.import_jobs_progress_check.value,
    /coalesce\("import_jobs"\."error_count", 0\)/i,
  );
  assert.match(
    nextImportJobs.checkConstraints.import_jobs_lifecycle_check.value,
    /cancelled/,
  );
  assert.match(
    nextImportJobs.checkConstraints.import_jobs_safe_error_check.value,
    /status" <> 'failed'/,
  );
  assert.match(
    nextImportJobs.checkConstraints.import_jobs_timestamp_order_check.value,
    /updated_at" >= "import_jobs"\."started_at"/,
  );
  assert.match(
    nextImportJobs.checkConstraints.import_jobs_timestamp_order_check.value,
    /updated_at" >= "import_jobs"\."finished_at"/,
  );

  delete previousImportJobs.columns.error;
  delete previousImportJobs.columns.status.default;
  delete previousImportJobs.columns.mode.default;
  delete previousImportJobs.columns.initiator_kind.default;
  delete previousImportJobs.columns.updated_at.default;
  previousImportJobs.columns.processed_count.notNull = true;
  previousImportJobs.foreignKeys = structuredClone(nextImportJobs.foreignKeys);
  delete previousImportJobs.checkConstraints.import_jobs_expand_counts_check;
  delete previousImportJobs.checkConstraints.import_jobs_safe_error_pair_check;
  for (const name of [
    "import_jobs_progress_check",
    "import_jobs_safe_error_check",
    "import_jobs_lifecycle_check",
    "import_jobs_initiator_check",
    "import_jobs_timestamp_order_check",
  ]) {
    previousImportJobs.checkConstraints[name] = structuredClone(
      nextImportJobs.checkConstraints[name],
    );
  }
  assert.deepEqual(nextImportJobs, previousImportJobs);
});

test("0018 follows 0017 in the migration journal", () => {
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as Journal;
  const previous = journal.entries.at(-2);
  const current = journal.entries.at(-1);

  assert.equal(previous?.idx, 17);
  assert.equal(previous?.tag, "0017_import_job_data_foundation_expand");
  assert.deepEqual(current, {
    idx: 18,
    version: "7",
    when: current?.when,
    tag: "0018_import_job_data_foundation_contract",
    breakpoints: true,
  });
});
