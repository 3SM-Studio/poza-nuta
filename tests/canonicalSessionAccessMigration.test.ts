import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "drizzle/0020_canonical_session_access.sql",
  "utf8",
);
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
};
const snapshot19 = JSON.parse(
  readFileSync("drizzle/meta/0019_snapshot.json", "utf8"),
) as Record<string, unknown>;
const snapshot20 = JSON.parse(
  readFileSync("drizzle/meta/0020_snapshot.json", "utf8"),
) as Record<string, unknown>;

test("migration 0020 is the next journal entry", () => {
  const entry = journal.entries.find(({ idx }) => idx === 20);
  assert.deepEqual(entry, {
    idx: 20,
    version: "7",
    when: entry?.when,
    tag: "0020_canonical_session_access",
    breakpoints: true,
  });
  assert.equal(snapshot20.prevId, snapshot19.id);
  assert.notEqual(snapshot20.id, snapshot19.id);
  assert.equal(existsSync("drizzle/0021_canonical_session_access.sql"), false);
});

test("migration backfills one CSPRNG-derived eight-digit code per event", () => {
  assert.match(migration, /ADD COLUMN "session_code" text/);
  assert.match(migration, /gen_random_uuid\(\)/);
  assert.match(migration, /FOR attempt IN 1\.\.64 LOOP/);
  assert.match(migration, /SET session_code = candidate/);
  assert.match(migration, /ALTER COLUMN "session_code" SET NOT NULL/);
  assert.match(migration, /events_session_code_format_check/);
  assert.match(migration, /events_session_code_idx/);
  assert.match(migration, /count\(DISTINCT session_code\)/);
});

test("migration disables legacy links without deleting history", () => {
  assert.match(migration, /UPDATE "public"\."event_access_links"/);
  assert.match(migration, /"active" = false/);
  assert.match(migration, /"revoked_at" = COALESCE/);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DROP TABLE/i);
});

test("migration preflight and locks precede schema changes", () => {
  const preflight = migration.indexOf("canonical_session_access_preflight");
  const eventLock = migration.indexOf('LOCK TABLE "public"."events"');
  const legacyLock = migration.indexOf(
    'LOCK TABLE "public"."event_access_links"',
  );
  const firstDdl = migration.indexOf('ADD COLUMN "session_code"');

  assert.ok(preflight >= 0);
  assert.ok(eventLock > preflight);
  assert.ok(legacyLock > eventLock);
  assert.ok(firstDdl > legacyLock);
});

test("snapshot 0020 changes only canonical event-code schema objects", () => {
  const before = structuredClone(snapshot19) as any;
  const after = structuredClone(snapshot20) as any;
  delete before.id;
  delete before.prevId;
  delete after.id;
  delete after.prevId;

  const beforeEvents = before.tables["public.events"];
  const afterEvents = after.tables["public.events"];
  delete before.tables["public.events"];
  delete after.tables["public.events"];
  assert.deepEqual(after, before);

  assert.deepEqual(afterEvents.columns.session_code, {
    name: "session_code",
    type: "text",
    primaryKey: false,
    notNull: true,
    default:
      "lpad((mod((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint), 100000000))::text, 8, '0')",
  });
  assert.equal(afterEvents.indexes.events_session_code_idx.isUnique, true);
  assert.match(
    afterEvents.checkConstraints.events_session_code_format_check.value,
    /\^\[0-9\]\{8\}\$/,
  );

  delete afterEvents.columns.session_code;
  delete afterEvents.indexes.events_session_code_idx;
  delete afterEvents.checkConstraints.events_session_code_format_check;
  assert.deepEqual(afterEvents, beforeEvents);
});

test("runtime event creation is atomic and retries only code collisions", () => {
  const organizations = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );

  assert.match(organizations, /withSessionCodeCollisionRetry/);
  assert.match(organizations, /isSessionCodeUniqueViolation/);
  assert.match(organizations, /sessionCode/);
  assert.match(organizations, /\.transaction\(/);
});
