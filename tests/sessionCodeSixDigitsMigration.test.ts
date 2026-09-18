import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migrationPath = "drizzle/0027_session_code_6_digits.sql";
const migration = readFileSync(migrationPath, "utf8");

test("0027 fails closed before atomic legacy remediation", () => {
  assert.match(migration, /^SET LOCAL lock_timeout = '5s';/);
  assert.match(migration, /SET LOCAL statement_timeout = '30s';/);
  assert.match(migration, /session_code_legacy_schema_preflight/);
  assert.match(migration, /session_code_legacy_data_preflight/);
  assert.match(migration, /session_code_legacy_active_event_preflight/);
  assert.match(migration, /session_code_legacy_pairing_preflight/);
  assert.match(migration, /session_code_legacy_uniqueness_preflight/);
  assert.match(migration, /session_code_legacy_capacity_preflight/);
  assert.match(migration, /session_code_legacy_locked_recheck/);
  assert.match(migration, /session_code_6_digits_metadata_verification/);
  assert.match(migration, /invalid_event_codes/);
  assert.match(migration, /invalid_history_codes/);
  assert.match(migration, /1000000/);
  assert.match(migration, /\n\s+6,\n\s+'0'/);
  assert.match(migration, /length\(session_code\) <> 8[\s\S]*translate\(session_code, '0123456789', ''\)/);
  assert.match(migration, /length\(code\) <> 8[\s\S]*translate\(code, '0123456789', ''\)/);
  assert.match(migration, /status NOT IN \('closed', 'cancelled'\)/);
  assert.match(migration, /starts_at > transaction_timestamp\(\)/);
  assert.match(migration, /coalesce\(auto_close_at, ends_at\) > transaction_timestamp\(\)/);
  assert.match(migration, /count\(DISTINCT session\.id\) <> 1/);
  assert.match(migration, /min\(history\.code\) IS DISTINCT FROM event\.session_code/);
  assert.match(migration, /CREATE TEMP TABLE session_code_legacy_mapping/);
  assert.match(migration, /row_number\(\) OVER \(ORDER BY code COLLATE "C"\) - 1/);
  assert.match(migration, /UPDATE public\.event_session_codes/);
  assert.match(migration, /UPDATE public\.events/);
  assert.match(migration, /SET legacy_code = history\.code/);
  assert.match(migration, /ADD COLUMN "legacy_code" text/);
  assert.equal(migration.match(/ADD CONSTRAINT .*code_format_check/g)?.length, 3);
  assert.match(migration, /ADD CONSTRAINT "event_session_codes_code_format_check"[\s\S]*NOT VALID/);
  assert.match(migration, /ADD CONSTRAINT "events_session_code_format_check"[\s\S]*NOT VALID/);
  assert.match(migration, /ADD CONSTRAINT "event_session_codes_legacy_code_format_check"[\s\S]*NOT VALID/);
  assert.doesNotMatch(migration, /VALIDATE CONSTRAINT/);
  assert.match(
    migration,
    /ALTER TABLE "public"\."events"\s+DROP CONSTRAINT "events_session_code_format_check";[\s\S]*LOCK TABLE "public"\."event_sessions" IN SHARE MODE;[\s\S]*ALTER TABLE "public"\."event_session_codes"\s+ADD COLUMN "legacy_code" text;/,
  );
  assert.doesNotMatch(migration, /ACCESS EXCLUSIVE/);
  assert.doesNotMatch(migration, /\[0-9\]\{6\}/);
  assert.doesNotMatch(migration, /\brandom\s*\(\s*\)/i);
  assert.match(migration, /event_session_codes_code_idx/);
  assert.match(migration, /event_session_codes_legacy_code_idx/);
  assert.match(migration, /events_session_code_idx/);
  assert.doesNotMatch(migration, /DROP (?:TABLE|INDEX|COLUMN)/i);
});

test("0027 runbook keeps validation in an exact later transaction", () => {
  const runbook = readFileSync(
    "docs/migrations/0027-session-code-6-digits.md",
    "utf8",
  );

  assert.match(runbook, /Stage 1 never reuses an issued code/);
  assert.match(runbook, /lifetime\ncapacity is therefore 1,000,000 issued codes/);
  assert.match(runbook, /deterministic/);
  assert.match(runbook, /write freeze/i);
  assert.match(runbook, /events` → `event_sessions` →\s*`event_session_codes`/);
  assert.match(runbook, /no release-operator\s+write bypass/);
  assert.match(runbook, /Remove the write freeze\.[\s\S]*controlled write smoke/);
  assert.match(runbook, /POINT OF NO SIMPLE ROLLBACK/);
  assert.match(runbook, /old\s+eight-digit bookmarks/i);
  assert.match(runbook, /release_after[\s\S]{0,100}retention metadata only/);
  assert.match(runbook, /Queue reads \(GET\)/);
  assert.match(runbook, /Search reads \(GET\)/);
  assert.match(runbook, /always returns `410` without code\nresolution/);
  assert.match(runbook, /observe data and a separate threshold/);
  assert.match(
    runbook,
    /BEGIN;[\s\S]*ALTER TABLE public\.event_session_codes\s+VALIDATE CONSTRAINT event_session_codes_code_format_check;[\s\S]*ALTER TABLE public\.event_session_codes\s+VALIDATE CONSTRAINT event_session_codes_legacy_code_format_check;[\s\S]*ALTER TABLE public\.events\s+VALIDATE CONSTRAINT events_session_code_format_check;[\s\S]*COMMIT;/,
  );
});

test("0027 snapshot adds legacy audit metadata and strict-six schema", () => {
  const before = readSnapshot("drizzle/meta/0026_snapshot.json");
  const after = readSnapshot("drizzle/meta/0027_snapshot.json");
  const expected = structuredClone(before);

  expected.id = after.id;
  expected.prevId = before.id;
  expected.tables["public.events"].columns.session_code.default =
    "lpad((mod((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint), 1000000))::text, 6, '0')";
  expected.tables["public.events"].checkConstraints.events_session_code_format_check.value =
    'length("events"."session_code") = 6 AND octet_length(translate("events"."session_code", \'0123456789\', \'\')) = 0';
  expected.tables["public.event_session_codes"].checkConstraints.event_session_codes_code_format_check.value =
    'length("event_session_codes"."code") = 6 AND octet_length(translate("event_session_codes"."code", \'0123456789\', \'\')) = 0';
  expected.tables["public.event_session_codes"].columns.legacy_code = {
    name: "legacy_code",
    type: "text",
    primaryKey: false,
    notNull: false,
  };
  expected.tables["public.event_session_codes"].indexes.event_session_codes_legacy_code_idx = {
    name: "event_session_codes_legacy_code_idx",
    columns: [
      {
        expression: "legacy_code",
        isExpression: false,
        asc: true,
        nulls: "last",
      },
    ],
    isUnique: true,
    where: '"event_session_codes"."legacy_code" is not null',
    concurrently: false,
    method: "btree",
    with: {},
  };
  expected.tables["public.event_session_codes"].checkConstraints.event_session_codes_legacy_code_format_check = {
    name: "event_session_codes_legacy_code_format_check",
    value:
      '"event_session_codes"."legacy_code" is null or (length("event_session_codes"."legacy_code") = 8 AND octet_length(translate("event_session_codes"."legacy_code", \'0123456789\', \'\')) = 0)',
  };

  assert.deepEqual(after, expected);
});

test("legacy audit code is not read by application runtime", () => {
  const runtimeFiles = listSourceFiles("src").filter(
    (path) => path !== join("src", "db", "schema.ts"),
  );

  for (const path of runtimeFiles) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /\blegacyCode\b|\blegacy_code\b/, path);
  }
});

test("0027 is the latest journal entry", () => {
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as { entries: Array<{ idx: number; tag: string }> };

  assert.deepEqual(journal.entries.at(-1), {
    ...journal.entries.at(-1),
    idx: 27,
    tag: "0027_session_code_6_digits",
  });
});

type Snapshot = {
  id: string;
  prevId: string;
  tables: Record<
    string,
    {
      columns: Record<string, Record<string, unknown> & { default?: string }>;
      indexes: Record<string, Record<string, unknown>>;
      checkConstraints: Record<string, { name: string; value: string }>;
    }
  >;
};

function readSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}
