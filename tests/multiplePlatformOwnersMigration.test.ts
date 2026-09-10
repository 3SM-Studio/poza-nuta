import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const indexName = "platform_members_one_active_owner_idx";
const migrationPath = "drizzle/0014_multiple_platform_owners.sql";

type DrizzleSnapshot = {
  id: string;
  prevId: string;
  tables: Record<
    string,
    {
      indexes: Record<string, unknown>;
    }
  >;
};

test("multiple-owner schema removes only the one-active-owner index", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync(migrationPath, "utf8");

  assert.doesNotMatch(schema, /platform_members_one_active_owner_idx/);
  assert.match(
    schema,
    /uniqueIndex\("platform_members_operator_idx"\)\.on\(table\.operatorUserId\)/,
  );
  assert.equal(migration.trim(), `DROP INDEX "${indexName}";`);
});

test("multiple-owner migration has no data, role enum, auth or suspension changes", () => {
  const migration = readFileSync(migrationPath, "utf8");

  assert.doesNotMatch(
    migration,
    /(?:^|\n)\s*(?:UPDATE|DELETE FROM|TRUNCATE|INSERT INTO)\b/i,
  );
  assert.doesNotMatch(migration, /CREATE TYPE|ALTER TYPE|DROP TYPE/i);
  assert.doesNotMatch(
    migration,
    /operator_users|suspended_|auth\.users|platform_member_role/i,
  );
});

test("snapshot 0014 differs from 0013 only by the removed owner index", () => {
  const previous = readSnapshot("drizzle/meta/0013_snapshot.json");
  const current = readSnapshot("drizzle/meta/0014_snapshot.json");
  const expected = structuredClone(previous);
  const platformMembers =
    expected.tables["public.platform_members"] ??
    assert.fail("platform_members is missing from snapshot 0013");

  expected.id = current.id;
  expected.prevId = current.prevId;
  delete platformMembers.indexes[indexName];

  assert.equal(current.prevId, previous.id);
  assert.deepEqual(current, expected);
  assert.ok(
    current.tables["public.platform_members"]?.indexes[
      "platform_members_operator_idx"
    ],
  );
});

function readSnapshot(path: string): DrizzleSnapshot {
  return JSON.parse(readFileSync(path, "utf8")) as DrizzleSnapshot;
}
