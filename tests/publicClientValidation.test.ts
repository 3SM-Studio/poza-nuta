import assert from "node:assert/strict";
import test from "node:test";

import {
  canSearchPublicSongs,
  formatSongSource,
  normalizePublicSearchTerm,
} from "../src/components/public/validation.ts";

test("public search helper normalizes whitespace and enforces two characters", () => {
  assert.equal(normalizePublicSearchTerm("  dancing   queen  "), "dancing queen");
  assert.equal(canSearchPublicSongs(" a "), false);
  assert.equal(canSearchPublicSongs(" ab "), true);
  assert.equal(canSearchPublicSongs("光"), true);
  assert.equal(canSearchPublicSongs("Кино"), true);
  assert.equal(canSearchPublicSongs("%%%"), false);
  assert.equal(canSearchPublicSongs("\u0301\u0300"), false);
});

test("formatSongSource returns participant-facing source labels", () => {
  assert.equal(formatSongSource("ising"), "iSing");
  assert.equal(formatSongSource("karafun"), "KaraFun");
  assert.equal(formatSongSource("manual"), "Ręcznie");
});
