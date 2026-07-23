import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "drizzle/0021_public_event_session_identity_expand.sql";
const snapshot20Path = "drizzle/meta/0020_snapshot.json";
const snapshot21Path = "drizzle/meta/0021_snapshot.json";

test("0021 is an expand-only fail-fast migration", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const firstDdl = migration.indexOf('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  assert.ok(firstDdl > 0);
  assert.ok(migration.indexOf("public_event_session_identity_preflight") < firstDdl);
  assert.match(migration, /^SET LOCAL lock_timeout = '5s';/);
  assert.match(migration, /SET LOCAL statement_timeout = '120s';/);
  assert.match(migration, /LOCK TABLE "public"\."events" IN ACCESS EXCLUSIVE MODE/);
  assert.match(migration, /gen_random_bytes\(16\)/);
  assert.match(migration, /translate\(encode\(gen_random_bytes\(16\), 'base64'\), '\+\/', '-_'\)/);
  assert.match(migration, /CREATE TABLE "public"\."event_sessions"/);
  assert.match(migration, /CREATE TABLE "public"\."event_session_codes"/);
  assert.match(migration, /event_session_codes_current_session_idx/);
  assert.match(migration, /event_session_codes_code_idx/);
  assert.match(
    migration,
    /"valid_until" = "revoked_at" AND "revoked_at" >= "valid_from"/,
  );
  assert.match(
    migration,
    /"release_after" >= "revoked_at" \+ interval '365 days'/,
  );
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON TABLE "public"\."event_sessions"\s+FROM PUBLIC, "anon", "authenticated"/,
  );
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON SEQUENCE "public"\."event_session_codes_id_seq"\s+FROM PUBLIC, "anon", "authenticated"/,
  );
  assert.match(migration, /public:session:/);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migration, /DROP INDEX[^;]*events_session_code_idx/i);
  assert.equal(existsSync("drizzle/0022_public_event_session_identity_contract.sql"), false);
});

test("0020 migration and snapshot remain bit-for-bit unchanged", () => {
  assert.equal(
    sha256("drizzle/0020_canonical_session_access.sql"),
    "386337deb9b9fda76cb232839f0a3cf309812593260416442d21ccba7376807c",
  );
  assert.equal(
    sha256(snapshot20Path),
    "1371e27815809c2a7239d175343b0bbf46fceae185b835fdecefab5085af9636",
  );
});

test("0021 snapshot adds only event identity and close metadata", () => {
  const before = JSON.parse(readFileSync(snapshot20Path, "utf8")) as Snapshot;
  const after = JSON.parse(readFileSync(snapshot21Path, "utf8")) as Snapshot;

  assert.equal(after.prevId, before.id);
  assert.notEqual(after.id, before.id);
  assert.deepEqual(
    Object.keys(after.tables).filter((name) => !(name in before.tables)),
    ["public.event_session_codes", "public.event_sessions"],
  );

  for (const tableName of Object.keys(before.tables)) {
    if (tableName === "public.events") continue;
    assert.deepEqual(after.tables[tableName], before.tables[tableName], tableName);
  }

  const beforeEvents = structuredClone(before.tables["public.events"]);
  const afterEvents = structuredClone(after.tables["public.events"]);
  assert.deepEqual(
    Object.keys(afterEvents.columns).filter((name) => !(name in beforeEvents.columns)),
    ["public_id", "close_reason"],
  );
  assert.deepEqual(
    Object.keys(afterEvents.indexes).filter((name) => !(name in beforeEvents.indexes)),
    ["events_public_id_idx"],
  );
  assert.deepEqual(
    Object.keys(afterEvents.checkConstraints).filter(
      (name) => !(name in beforeEvents.checkConstraints),
    ),
    ["events_close_reason_check"],
  );

  delete afterEvents.columns.public_id;
  delete afterEvents.columns.close_reason;
  delete afterEvents.indexes.events_public_id_idx;
  delete afterEvents.checkConstraints.events_close_reason_check;
  assert.deepEqual(afterEvents, beforeEvents);
  assert.deepEqual(after.enums, before.enums);

  const codeChecks =
    after.tables["public.event_session_codes"].checkConstraints;
  assert.match(
    String(
      (
        codeChecks.event_session_codes_chronology_check as {
          value: string;
        }
      ).value,
    ),
    /valid_until.*=.*revoked_at.*revoked_at.*>=.*valid_from/s,
  );
  assert.match(
    String(
      (
        codeChecks.event_session_codes_revocation_check as {
          value: string;
        }
      ).value,
    ),
    /release_after.*>=.*revoked_at.*365 days/s,
  );
});

test("journal, package, schema, creation flows, and canonical routes expose 0021", () => {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.equal(journal.entries.at(-1)?.idx, 21);
  assert.equal(
    journal.entries.at(-1)?.tag,
    "0021_public_event_session_identity_expand",
  );

  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts["test:postgres:public-event-session-identity"],
    "vitest run --config vitest.public-session-postgres.config.ts",
  );

  const schema = readFileSync("src/db/schema.ts", "utf8");
  assert.match(schema, /publicId: uuid\("public_id"\)\.notNull\(\)\.defaultRandom\(\)/);
  assert.match(schema, /export const eventSessions = pgTable/);
  assert.match(schema, /export const eventSessionCodes = pgTable/);

  for (const path of [
    "src/server/event-lifecycle.ts",
    "src/server/operator-api/organizations.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /withEventSessionIdentityRetry/);
    assert.match(source, /insertEventSessionIdentity/);
  }

  const share = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/share/page.tsx",
    "utf8",
  );
  assert.match(share, /`\/s\/\$\{result\.event\.publicToken\}`/);
  assert.doesNotMatch(share, /`\/session\/\$\{result\.event\.sessionCode\}`/);

  const resolver = readFileSync(
    "src/server/session-api/code-resolver-response.ts",
    "utf8",
  );
  assert.match(resolver, /status: 307/);
  assert.match(resolver, /Cache-Control.*no-store/);
  assert.match(resolver, /X-Robots-Tag/);
});

type SnapshotTable = {
  columns: Record<string, unknown>;
  indexes: Record<string, unknown>;
  checkConstraints: Record<string, unknown>;
};

type Snapshot = {
  id: string;
  prevId: string;
  tables: Record<string, SnapshotTable>;
  enums: Record<string, unknown>;
};

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
