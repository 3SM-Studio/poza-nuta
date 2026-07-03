import assert from "node:assert/strict";
import test from "node:test";

import {
  canSearchPublicSongs,
  formatSongSource,
  normalizePublicSearchTerm,
  PUBLIC_NOTE_MAX_LENGTH,
  PUBLIC_SINGER_NAME_MAX_LENGTH,
  validatePublicRequestForm,
} from "../src/components/public/validation.ts";

test("validatePublicRequestForm trims and accepts valid participant input", () => {
  assert.deepEqual(
    validatePublicRequestForm({
      songId: 42,
      singerName: "  Alicja  ",
      note: "  Niższa tonacja  ",
    }),
    {
      success: true,
      data: {
        songId: 42,
        singerName: "Alicja",
        note: "Niższa tonacja",
      },
    },
  );
});

test("validatePublicRequestForm requires a song and singer name", () => {
  const result = validatePublicRequestForm({
    songId: null,
    singerName: " ",
    note: "",
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.success ? {} : result.errors,
    {
      songId: "Wybierz piosenkę.",
      singerName: "Podaj imię lub ksywkę.",
    },
  );
});

test("validatePublicRequestForm enforces public field limits", () => {
  const result = validatePublicRequestForm({
    songId: 1,
    singerName: "a".repeat(PUBLIC_SINGER_NAME_MAX_LENGTH + 1),
    note: "b".repeat(PUBLIC_NOTE_MAX_LENGTH + 1),
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.success ? [] : Object.keys(result.errors),
    ["singerName", "note"],
  );
});

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
