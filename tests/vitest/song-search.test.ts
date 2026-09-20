import { describe, expect, it } from "vitest";

import {
  normalizeSongSearchQuery,
  normalizeSongSearchText,
  SONG_SEARCH_MAX_TOKENS,
  tokenizeSongSearchQuery,
} from "@/lib/song-search";
import { normalizeSearchQuery, validateSearchQuery } from "@/server/public-api/validation";

describe("song search normalization", () => {
  it.each([
    ["Górniak", "gorniak"],
    ["GÓRNIAK", "gorniak"],
    ["ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż", "acelnoszz acelnoszz"],
    ["  Poker---Face   (Live) ", "poker face live"],
    ["Beyoncé / Björk", "beyonce bjork"],
    ["François d'Estaing", "francois d estaing"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeSongSearchText(input)).toBe(expected);
    expect(normalizeSongSearchQuery(input)).toBe(expected);
    expect(normalizeSearchQuery(input)).toBe(expected);
  });

  it.each([
    ["Кино", ""],
    ["Океан Ельзи", ""],
    ["Ляпис Трубецкой", ""],
    ["Μίκης Θεοδωράκης", ""],
    ["Øresund", "resund"],
    ["Straße", "stra e"],
  ])("documents the current non-Latin limitation for %s", (input, expected) => {
    expect(normalizeSongSearchText(input)).toBe(expected);
  });

  it("deduplicates important tokens and bounds query work", () => {
    const query = Array.from(
      { length: SONG_SEARCH_MAX_TOKENS + 5 },
      (_, index) => `token${index}`,
    ).join(" ");

    expect(tokenizeSongSearchQuery(`abba abba dancing queen`)).toEqual([
      "abba",
      "dancing",
      "queen",
    ]);
    expect(tokenizeSongSearchQuery(query)).toHaveLength(SONG_SEARCH_MAX_TOKENS);
    expect(tokenizeSongSearchQuery("a i")).toEqual([]);
  });

  it("applies the normalized two-character endpoint threshold", () => {
    expect(validateSearchQuery(" ż ")).toEqual({ success: true, data: null });
    expect(validateSearchQuery("  ŁÓ  ")).toEqual({ success: true, data: "lo" });
    expect(validateSearchQuery("Кино")).toEqual({ success: true, data: null });
  });

  it.each([
    "Кино",
    "Океан Ельзи",
    "Ляпис Трубецкой",
    "Μίκης Θεοδωράκης",
    "ØØ",
    "ßß",
    "🎤🎶",
    "---...!!!",
  ])("fails closed when %s has fewer than two usable normalized characters", (input) => {
    expect(validateSearchQuery(input)).toEqual({ success: true, data: null });
  });
});
