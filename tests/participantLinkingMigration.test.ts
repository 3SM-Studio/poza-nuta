import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Slice 4 migration is additive, private, scoped and linked to the Drizzle journal", () => {
  const migration = readFileSync("drizzle/0030_participant_linking.sql", "utf8");
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE FROM)\b/i);
  assert.match(migration, /REVOKE ALL ON TABLE public.participant_device_links, public.participant_merge_proposals FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /event_participant_alias_scope/);
  assert.match(migration, /participant_proposal_event_scope/);
  assert.match(migration, /FOR SHARE/);
  const previous = JSON.parse(readFileSync("drizzle/meta/0029_snapshot.json", "utf8"));
  const next = JSON.parse(readFileSync("drizzle/meta/0030_snapshot.json", "utf8"));
  assert.equal(next.prevId, previous.id);
  for (const table of ["participant_device_links", "participant_merge_proposals"]) {
    const model = next.tables[`public.${table}`];
    assert.equal(model.isRLSEnabled, true);
    for (const name of Object.keys(model.foreignKeys)) assert.ok(name.length <= 63, name);
  }
  for (const [name, table] of Object.entries(previous.tables)) {
    if (name !== "public.event_participants") assert.deepEqual(next.tables[name], table, name);
  }
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  assert.equal(journal.entries.find((entry: { idx: number }) => entry.idx === 30)?.tag, "0030_participant_linking");
});
