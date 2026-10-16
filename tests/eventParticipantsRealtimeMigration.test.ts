import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("0028 appends an additive SQL migration without changing business table snapshots", () => {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string }[] };
  assert.equal(journal.entries.find(({ idx }) => idx === 28)?.tag, "0028_event_participants_realtime");
  const previous = JSON.parse(readFileSync("drizzle/meta/0027_snapshot.json", "utf8"));
  const next = JSON.parse(readFileSync("drizzle/meta/0028_snapshot.json", "utf8"));
  assert.equal(next.prevId, previous.id);
  assert.deepEqual({ ...next, id: previous.id, prevId: previous.prevId }, previous);
  const migration = readFileSync("drizzle/0028_event_participants_realtime.sql", "utf8");
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE FROM|ALTER TABLE)\b/i);
  assert.match(migration, /SET search_path = ''/);
  assert.match(migration, /suspended_at IS NULL/);
  assert.match(migration, /REVOKE ALL ON FUNCTION/);
});
