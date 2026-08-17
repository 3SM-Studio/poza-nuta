import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "drizzle/0023_foamy_gargoyle.sql";

test("0023 adds additive participant identity tables and nullable request ownership", () => {
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(migration, /CREATE TABLE "participant_identities"/);
  assert.match(migration, /CREATE TABLE "participant_credentials"/);
  assert.match(migration, /CREATE TABLE "event_participants"/);
  assert.match(
    migration,
    /ALTER TABLE "song_requests" ADD COLUMN "event_participant_id" bigint/,
  );
  assert.doesNotMatch(
    migration,
    /ADD COLUMN "event_participant_id" bigint NOT NULL/,
  );
  assert.match(migration, /ON DELETE set null/);
  assert.match(migration, /event_participants_session_participant_idx/);
  assert.match(migration, /event_participants_session_nickname_idx/);
  assert.match(migration, /participant_credentials_token_hash_format_check/);
  assert.equal((migration.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length, 3);
  assert.doesNotMatch(migration, /CREATE POLICY|GRANT .*anon|GRANT .*authenticated/i);
  assert.doesNotMatch(migration, /token[^\n]*DEFAULT|credential[^\n]*DEFAULT/i);
});

test("0023 is the next immutable Drizzle journal entry", () => {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
    entries: Array<{
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>;
  };
  assert.deepEqual(journal.entries.at(-1), {
    idx: 23,
    version: "7",
    when: journal.entries.at(-1)?.when,
    tag: "0023_foamy_gargoyle",
    breakpoints: true,
  });
});
