import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  normalizeSongSearchQuery,
  normalizeSongSearchText,
  SONG_SEARCH_MAX_TOKENS,
  tokenizeSongSearchQuery,
  isMeaningfulSongSearch,
  songSearchGrams,
  canFuzzySearchSongs,
} from "@/lib/song-search";
import { normalizeSearchQuery, validateSearchQuery } from "@/server/public-api/validation";
import { isUnicodeSongSearchEnabled } from "@/lib/song-search-engine";

describe("song search normalization", () => {
  beforeEach(() => vi.stubEnv("SONG_SEARCH_ENGINE", "unicode-v2"));
  afterEach(() => vi.unstubAllEnvs());
  it("rejects unknown engines and mismatched normalization runtimes before search", () => {
    expect(isUnicodeSongSearchEnabled("17.0")).toBe(true);
    expect(() => isUnicodeSongSearchEnabled("16.0")).toThrow("verified Unicode 17 runtime");
    vi.stubEnv("SONG_SEARCH_ENGINE", "unknown");
    expect(() => isUnicodeSongSearchEnabled()).toThrow("Unrecognized");
  });
  it("keeps a safe explicit legacy rollback", () => {
    vi.stubEnv("SONG_SEARCH_ENGINE", "legacy");
    expect(validateSearchQuery("ØØ")).toEqual({ success: true, data: null });
    expect(validateSearchQuery("Кино")).toEqual({ success: true, data: null });
    expect(normalizeSearchQuery("Górniak")).toBe("gorniak");
  });
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
    ["Кино", "кино"],
    ["Океан Ельзи", "океан ельзи"],
    ["Ляпис Трубецкой", "ляпис трубецкой"],
    ["Μίκης Θεοδωράκης", "μίκησ θεοδωράκησ"],
    ["Øresund", "oresund"],
    ["Straße", "strasse"],
    ["عمرو دياب", "عمرو دياب"], ["अरिजीत सिंह", "अरिजीत सिंह"],
    ["周杰伦", "周杰伦"], ["宇多田ヒカル", "宇多田ヒカル"], ["방탄소년단", "방탄소년단"],
    ["נעמי שמר", "נעמי שמר"], ["นนท์ ธนนท์", "นนท์ ธนนท์"],
  ])("preserves Unicode search identity for %s", (input, expected) => {
    expect(normalizeSongSearchText(input)).toBe(expected.normalize("NFD"));
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
    expect(tokenizeSongSearchQuery("song 1 1 ٢")).toEqual(["song", "1", "٢"]);
  });

  it("applies the normalized two-character endpoint threshold", () => {
    expect(validateSearchQuery(" ż ")).toEqual({ success: true, data: null });
    expect(validateSearchQuery("  ŁÓ  ")).toEqual({ success: true, data: "lo" });
    expect(validateSearchQuery("Кино")).toEqual({ success: true, data: "кино" });
    expect(validateSearchQuery("光")).toEqual({ success: true, data: "光" });
  });

  it.each([
    "🎤🎶",
    "---...!!!",
  ])("fails closed when %s has fewer than two usable normalized characters", (input) => {
    expect(validateSearchQuery(input)).toEqual({ success: true, data: null });
  });

  it("uses canonical equivalence without deleting non-Latin vowel marks", () => {
    for (const value of ["Café", "अरिजीत सिंह", "שָׁלוֹם", "กิ", "Μίκης", "한글", "عَمْرُو"]) {
      expect(normalizeSongSearchText(value.normalize("NFD"))).toBe(normalizeSongSearchText(value.normalize("NFC")));
      expect(normalizeSongSearchText(normalizeSongSearchText(value))).toBe(normalizeSongSearchText(value));
    }
    expect(normalizeSongSearchText("कि")).not.toBe(normalizeSongSearchText("क"));
    expect(normalizeSongSearchText("שָׁלוֹם")).not.toBe(normalizeSongSearchText("שלום"));
    expect(normalizeSongSearchText("عَمْرُو")).not.toBe(normalizeSongSearchText("عمرو"));
  });
  it("selects literal n-grams for short/continuous scripts rather than global fuzzy matching", () => {
    expect(isMeaningfulSongSearch("光")).toBe(true);
    expect(isMeaningfulSongSearch("a")).toBe(false);
    expect(songSearchGrams("周杰伦")).toEqual(expect.arrayContaining(["周", "周杰", "杰伦"]));
    expect(canFuzzySearchSongs("кино")).toBe(true);
    for (const query of ["周杰伦", "รักแรก", "عمرو", "שלום", "अरिजीत"]) expect(canFuzzySearchSongs(query)).toBe(false);
  });
  it("bounds adversarial queries before normalization or SQL", () => {
    for (const query of ["a".repeat(101), "a" + "\u0301".repeat(17), "光".repeat(101)]) expect(validateSearchQuery(query).success).toBe(false);
    for (const query of ["%%%___", "\u0301\u0300", "\u202e\u2067"]) expect(validateSearchQuery(query)).toEqual({ success: true, data: null });
    expect(validateSearchQuery("ab%_\\cd")).toEqual({ success: true, data: "ab cd" });
  });
});
