import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

test("Presence migration expands the schema with denied browser access and private invalidation", () => {
  const migration = readFileSync("drizzle/0029_participant_presence.sql", "utf8");
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public.participant_connections FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /SET search_path = ''/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE FROM)\b/i);
  const previous = JSON.parse(readFileSync("drizzle/meta/0028_snapshot.json", "utf8"));
  const next = JSON.parse(readFileSync("drizzle/meta/0029_snapshot.json", "utf8"));
  assert.equal(next.prevId, previous.id);
  const { "public.participant_connections": connections, ...existingTables } = next.tables;
  assert.ok(connections.isRLSEnabled);
  assert.deepEqual(existingTables, previous.tables, "No existing business table rewritten");
  assert.equal(Object.keys(connections.foreignKeys).length, 2);
  assert.ok(Object.keys(connections.foreignKeys).every(name => name.length <= 63));
});

test("The active PostgreSQL integration matrix permits only version 17", () => {
  const files = readdirSync("tests/postgres").filter(file => /\.tsx?$/.test(file));
  for (const file of files) {
    const source = readFileSync(`tests/postgres/${file}`, "utf8");
    assert.doesNotMatch(source, /postgres:(?:15|16|18)(?:-|\b)/, file);
  }
  const harness = readFileSync("tests/postgres/postgresTestHarness.ts", "utf8");
  assert.match(harness, /POSTGRES_TEST_IMAGE = "postgres:17-alpine"/);
  assert.match(harness, /assert\.match\(image, \/\^postgres:17-alpine\$\//);
  const smoke = readFileSync("tests/e2e/run-local-supabase-smoke.ts", "utf8");
  assert.match(smoke, /major_version = 17/);
  assert.match(smoke, /server_version_num/);
});
