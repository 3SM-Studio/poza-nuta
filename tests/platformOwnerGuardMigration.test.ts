import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "drizzle/0015_platform_owner_guard.sql";

type DrizzleSnapshot = {
  id: string;
  prevId: string;
  [key: string]: unknown;
};

test("platform owner guard remains private and migration-owned", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync(migrationPath, "utf8");

  assert.doesNotMatch(schema, /platform_owner_guard/);
  assert.match(
    migration,
    /CREATE TABLE "private"\."platform_owner_guard"/,
  );
  assert.match(migration, /REVOKE ALL ON TABLE[\s\S]*FROM PUBLIC/);
});

test("snapshot 0015 preserves the public snapshot from 0014", () => {
  const previous = readSnapshot("drizzle/meta/0014_snapshot.json");
  const current = readSnapshot("drizzle/meta/0015_snapshot.json");
  const expected = structuredClone(previous);

  expected.id = current.id;
  expected.prevId = current.prevId;

  assert.equal(current.prevId, previous.id);
  assert.deepEqual(current, expected);
});

test("guard functions are security definer with an empty search path", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const functions = [
    "serialize_platform_owner_transition",
    "validate_and_arm_platform_owner_guard",
    "protect_platform_owner_guard",
  ];

  for (const functionName of functions) {
    assert.match(
      migration,
      new RegExp(
        `CREATE FUNCTION "private"\\."${functionName}"\\(\\)[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = ''[\\s\\S]*?AS \\$\\$`,
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION "private"\\."${functionName}"\\(\\) FROM PUBLIC`,
      ),
    );
  }

  assert.doesNotMatch(migration, /EXECUTE\s+FORMAT/i);
  assert.doesNotMatch(migration, /ALTER\s+(?:FUNCTION|TABLE).*OWNER/i);
});

test("eligible owner query uses only the accepted four conditions", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const validationStart = migration.indexOf(
    'CREATE FUNCTION "private"."validate_and_arm_platform_owner_guard"',
  );
  const protectionStart = migration.indexOf(
    'CREATE FUNCTION "private"."protect_platform_owner_guard"',
  );
  const validation = migration.slice(validationStart, protectionStart);

  assert.notEqual(validationStart, -1);
  assert.notEqual(protectionStart, -1);
  assert.match(validation, /"operator_users"\."active" = true/);
  assert.match(validation, /"operator_users"\."suspended_at" IS NULL/);
  assert.match(validation, /"platform_members"\."active" = true/);
  assert.match(
    validation,
    /"platform_members"\."role" = 'platform_owner'/,
  );
  assert.doesNotMatch(
    validation,
    /auth_user_id|workspace_members|workspaces|completeOwnerLinks/i,
  );
});

test("guard uses normal triggers and a stable safe error contract", () => {
  const migration = readFileSync(migrationPath, "utf8");

  assert.doesNotMatch(migration, /ENABLE ALWAYS/i);
  assert.match(migration, /ERRCODE = '23514'/);
  assert.match(
    migration,
    /CONSTRAINT = 'eligible_platform_owner_required'/,
  );
  assert.doesNotMatch(migration, /auth_user_id|completeOwnerLinks/i);
});

test("migration does not rewrite or delete business data", () => {
  const migration = readFileSync(migrationPath, "utf8");

  assert.doesNotMatch(
    migration,
    /UPDATE\s+"public"\."(?:operator_users|platform_members|workspace_members|workspaces|events)"/i,
  );
  assert.doesNotMatch(
    migration,
    /DELETE\s+FROM\s+"public"\."(?:operator_users|platform_members|workspace_members|workspaces|events)"/i,
  );
  assert.doesNotMatch(
    migration,
    /TRUNCATE\s+(?:TABLE\s+)?"public"\./i,
  );
});

function readSnapshot(path: string): DrizzleSnapshot {
  return JSON.parse(readFileSync(path, "utf8")) as DrizzleSnapshot;
}
