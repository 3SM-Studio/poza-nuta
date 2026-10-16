import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Unicode search migration adds private derived tables and leaves all existing models unchanged", () => {
  const before = JSON.parse(readFileSync("drizzle/meta/0030_snapshot.json", "utf8"));
  const after = JSON.parse(readFileSync("drizzle/meta/0031_snapshot.json", "utf8"));
  assert.equal(after.prevId, before.id);
  for (const [name, model] of Object.entries(before.tables)) assert.deepEqual(after.tables[name], model, name);
  for (const name of ["song_search_documents", "song_search_aliases"]) assert.equal(after.tables[`public.${name}`].isRLSEnabled, true);
  const migration = readFileSync("drizzle/0031_unicode_song_search.sql", "utf8");
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE FROM|UPDATE songs SET)\b/i);
  assert.match(migration, /SECURITY DEFINER SET search_path = pg_catalog/);
  assert.match(migration, /FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /AFTER INSERT OR UPDATE OF title, artist, search_text, genres, languages/);
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  assert.equal(journal.entries.find((entry: { idx: number }) => entry.idx === 31)?.tag, "0031_unicode_song_search");
});
