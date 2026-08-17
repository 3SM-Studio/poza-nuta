import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const indexName = "events_one_active_public_per_workspace_idx";
const migrationPath = "drizzle/0022_multi_active_public_events.sql";
const snapshot21Path = "drizzle/meta/0021_snapshot.json";
const snapshot22Path = "drizzle/meta/0022_snapshot.json";

test("0022 fails fast on the exact legacy index before dropping it", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const dropIndex = `DROP INDEX "public"."${indexName}";`;

  assert.match(migration, /^SET LOCAL lock_timeout = '5s';/);
  assert.match(migration, /SET LOCAL statement_timeout = '30s';/);
  assert.match(
    migration,
    /LOCK TABLE "public"\."events" IN ACCESS EXCLUSIVE MODE/,
  );
  assert.ok(migration.indexOf("DO $$") < migration.indexOf(dropIndex));
  assert.match(migration, /i\.indisunique/);
  assert.match(migration, /i\.indisvalid/);
  assert.match(migration, /i\.indisready/);
  assert.match(migration, /indexed_column\.attname = 'workspace_id'/);
  assert.match(migration, /\(is_active_public_event = true\)/);
  assert.match(migration, /ERRCODE = '23514'/);
  assert.match(
    migration,
    /CONSTRAINT = 'events_one_active_public_per_workspace_idx_contract'/,
  );
  assert.equal(migration.match(/\bDROP\s+INDEX\b/gi)?.length, 1);
  assert.equal(migration.match(new RegExp(indexName, "g"))?.length, 3);
  assert.equal(migration.trim().endsWith(dropIndex), true);
});

test("0022 changes no data or schema object other than the legacy index", () => {
  const migration = readFileSync(migrationPath, "utf8");

  assert.doesNotMatch(
    migration,
    /(?:^|\n)\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\b/im,
  );
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migration, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(migration, /\bCREATE\s+(?:TABLE|INDEX|TYPE|POLICY)\b/i);
  assert.doesNotMatch(migration, /\b(?:GRANT|REVOKE)\b/i);
});

test("0022 snapshot differs from 0021 only by metadata and the removed index", () => {
  const before = readSnapshot(snapshot21Path);
  const after = readSnapshot(snapshot22Path);
  const expected = structuredClone(before);
  const events =
    expected.tables["public.events"] ??
    assert.fail("public.events is missing from snapshot 0021");

  expected.id = after.id;
  expected.prevId = after.prevId;
  delete events.indexes[indexName];

  assert.equal(after.prevId, before.id);
  assert.notEqual(after.id, before.id);
  assert.deepEqual(after, expected);
  assert.ok(after.tables["public.events"]?.columns.is_active_public_event);
});

test("journal, schema, services, and UI expose the multi-active contract", () => {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const lifecycle = readFileSync(
    "src/lib/dashboard-event-lifecycle.ts",
    "utf8",
  );
  const organizations = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );
  const createPage = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/new/page.tsx",
    "utf8",
  );
  const settingsPage = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/settings/page.tsx",
    "utf8",
  );
  const managementPanel = readFileSync(
    "src/components/operator/event-management-panel.tsx",
    "utf8",
  );

  assert.deepEqual(journal.entries.find(({ idx }) => idx === 22), {
    idx: 22,
    version: "7",
    when: 1785875185006,
    tag: "0022_multi_active_public_events",
    breakpoints: true,
  });
  assert.doesNotMatch(schema, new RegExp(indexName));
  assert.match(schema, /isActivePublicEvent: boolean\("is_active_public_event"\)/);
  for (const source of [lifecycle, organizations, createPage, settingsPage]) {
    assert.doesNotMatch(source, /ACTIVE_PUBLIC_EVENT_ALREADY_EXISTS/);
  }
  assert.doesNotMatch(managementPanel, /tylko jeden aktywny publicznie event/);
  assert.equal(existsSync("drizzle/0023_multi_active_public_events.sql"), false);
});

test("0021 artifacts remain bit-for-bit unchanged", () => {
  assert.equal(
    sha256("drizzle/0021_public_event_session_identity_expand.sql"),
    "e12a7a67cfb976688f518e8b67b5b043d4ecea9413a337f3d59d3a1cf055620f",
  );
  assert.equal(
    sha256(snapshot21Path),
    "6d7670fd5a2a17b3d773bacedd0deee08390a62918ff42e9283fa7c2335d9f24",
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
    }
  >;
};

function readSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
