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
});

test("formatSongSource returns participant-facing source labels", () => {
  assert.equal(formatSongSource("ising"), "iSing");
  assert.equal(formatSongSource("karafun"), "KaraFun");
  assert.equal(formatSongSource("manual"), "Ręcznie");
});
