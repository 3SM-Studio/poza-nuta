import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "drizzle/0019_import_job_worker_foundation.sql";
const runbookPath = "docs/migrations/0019-import-job-worker-foundation.md";
const snapshot18Path = "drizzle/meta/0018_snapshot.json";
const snapshot19Path = "drizzle/meta/0019_snapshot.json";

test("0019 defines the worker foundation and fail-fast preflight", () => {
  const source = readFileSync(migrationPath, "utf8");
  const firstDdl = source.indexOf('CREATE TYPE "public"."audit_actor_kind"');
  assert.ok(source.startsWith('LOCK TABLE "public"."import_jobs"'));
  assert.ok(firstDdl > 0);
  for (const contract of [
    "import_job_worker_migration_active_jobs",
    "import_job_worker_status_contract",
    "import_job_worker_enum_contract",
    "import_job_worker_column_contract",
    "import_job_worker_audit_column_contract",
    "import_job_worker_constraint_contract",
    "import_job_worker_index_contract",
    "import_job_worker_fk_contract",
    "import_job_worker_rls_contract",
    "import_job_worker_objects_absent",
  ]) {
    assert.ok(source.indexOf(contract) < firstDdl, `${contract} must precede DDL`);
  }

  assert.match(source, /CREATE ROLE "import_worker"\s+NOLOGIN/);
  assert.doesNotMatch(source, /PASSWORD|CREATE ROLE[^;]*\bLOGIN\b/i);
  assert.match(source, /NOBYPASSRLS/);
  assert.match(source, /CREATE UNIQUE INDEX "import_jobs_claim_token_idx"/);
  assert.doesNotMatch(source, /WHERE[^;]*now\(\)/i);
  assert.match(source, /CREATE FUNCTION "private"\."protect_terminal_import_job"/);
  assert.match(
    source,
    /OLD\."cancellation_requested_by_operator_id" IS NOT NULL[\s\S]*NEW\."cancellation_requested_by_operator_id" IS NULL/,
  );
  assert.match(
    source,
    /pg_catalog\.to_jsonb\(NEW\) - 'cancellation_requested_by_operator_id'[\s\S]*pg_catalog\.to_jsonb\(OLD\) - 'cancellation_requested_by_operator_id'/,
  );
  assert.match(source, /CONSTRAINT = 'import_jobs_terminal_immutable'/);
  assert.match(source, /GRANT SELECT, UPDATE ON TABLE "public"\."import_jobs"/);
  assert.doesNotMatch(source, /GRANT[^;]*(DELETE|TRUNCATE|CREATE)/i);
  assert.match(source, /REVOKE CREATE ON SCHEMA "public"/);
});

test("0019 runbook requires atomic release choreography and role-aware restore", () => {
  const source = readFileSync(runbookPath, "utf8");
  assert.match(source, /full maintenance\/write freeze/);
  assert.match(source, /stopped and drained/);
  assert.match(source, /Login\/logout, event[\s\S]*session[\s\S]*platform[\s\S]*auto-close/);
  assert.match(source, /Ticket 13A and Ticket 13B are one release unit/);
  assert.match(source, /Never deploy the Ticket 13A commit separately against schema 0018/);
  assert.match(source, /global PostgreSQL cluster role/);
  assert.match(source, /does not contain `CREATE ROLE`/);
  assert.match(source, /complete restore of a post-0019 backup[\s\S]*mandatory/);
});

test("0019 snapshot adds only the declared public schema contract", () => {
  const before = snapshot(snapshot18Path);
  const after = snapshot(snapshot19Path);
  assert.equal(after.prevId, before.id);
  assert.notEqual(after.id, before.id);

  const unchangedTables = Object.keys(before.tables).filter(
    (name) =>
      name !== "public.import_jobs" &&
      name !== "public.operator_audit_log",
  );
  for (const name of unchangedTables) {
    assert.deepEqual(after.tables[name], before.tables[name], name);
  }

  const beforeJobs = before.tables["public.import_jobs"];
  const afterJobs = after.tables["public.import_jobs"];
  assert.deepEqual(
    Object.keys(afterJobs.columns).filter((name) => !(name in beforeJobs.columns)),
    ["attempt_count", "claim_token", "lease_expires_at", "heartbeat_at"],
  );
  assert.deepEqual(
    Object.keys(afterJobs.indexes).filter((name) => !(name in beforeJobs.indexes)),
    [
      "import_jobs_queued_claim_idx",
      "import_jobs_recovery_idx",
      "import_jobs_claim_token_idx",
    ],
  );
  assert.deepEqual(
    Object.keys(afterJobs.checkConstraints).filter(
      (name) => !(name in beforeJobs.checkConstraints),
    ),
    [
      "import_jobs_worker_attempt_check",
      "import_jobs_worker_claim_check",
      "import_jobs_worker_lease_check",
    ],
  );

  const beforeAudit = before.tables["public.operator_audit_log"];
  const afterAudit = after.tables["public.operator_audit_log"];
  assert.deepEqual(
    Object.keys(afterAudit.columns).filter((name) => !(name in beforeAudit.columns)),
    ["actor_kind"],
  );
  assert.deepEqual(Object.keys(afterAudit.checkConstraints), [
    "operator_audit_log_actor_check",
  ]);
  assert.deepEqual(after.enums["public.audit_actor_kind"].values, [
    "operator",
    "system",
    "legacy",
  ]);
});

test("journal and package expose exactly the 0019 migration test", () => {
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as { entries: Array<{ idx: number; tag: string }> };
  assert.deepEqual(journal.entries.at(-1), {
    ...journal.entries.at(-1),
    idx: 19,
    tag: "0019_import_job_worker_foundation",
  });

  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts["test:postgres:import-job-worker-foundation"],
    "node --experimental-strip-types --test tests/postgres/importJobWorkerFoundation.integration.test.ts",
  );
});

type Snapshot = {
  id: string;
  prevId: string;
  tables: Record<
    string,
    {
      columns: Record<string, unknown>;
      indexes: Record<string, unknown>;
      checkConstraints: Record<string, unknown>;
    }
  >;
  enums: Record<string, { values: string[] }>;
};

function snapshot(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}
