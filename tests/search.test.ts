import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MissingLocalSongIndexError, readLocalSongIndex } from "../src/search/localSongIndex.ts";
import { searchSongs } from "../src/search/songSearch.ts";
import type { LocalSong } from "../src/songs/types.ts";

test("query without Polish diacritics finds a record with Polish diacritics", () => {
  const results = searchSongs("agnieszka chylinska", fixtureSongs());

  assert.equal(results[0]?.song.artist, "Agnieszka Chylińska");
});

test('"krolowa lez" finds "Królowa Łez"', () => {
  const results = searchSongs("krolowa lez", fixtureSongs());

  assert.equal(results[0]?.song.title, "Królowa Łez");
});

test('"chodz pomaluj moj swiat" finds "Chodź, pomaluj mój świat"', () => {
  const results = searchSongs("chodz pomaluj moj swiat", fixtureSongs());

  assert.equal(results[0]?.song.artist, "2+1");
  assert.equal(results[0]?.song.title, "Chodź, pomaluj mój świat");
});

test('"abba dancing queen" finds "ABBA - Dancing Queen"', () => {
  const results = searchSongs("abba dancing queen", fixtureSongs());

  assert.equal(results[0]?.song.artist, "ABBA");
  assert.equal(results[0]?.song.title, "Dancing Queen");
});

test('"bye bye bye" finds "*NSYNC - Bye Bye Bye"', () => {
  const results = searchSongs("bye bye bye", fixtureSongs());

  assert.equal(results[0]?.song.artist, "*NSYNC");
  assert.equal(results[0]?.song.title, "Bye Bye Bye");
});

test("exact title match scores higher than partial match", () => {
  const results = searchSongs("Dancing Queen", [
    song({ title: "Dancing Queen", artist: "ABBA" }),
    song({ title: "Dancing", artist: "Queen Tribute", searchText: "queen tribute dancing" })
  ]);

  assert.equal(results[0]?.song.artist, "ABBA");
  assert.ok(results[0].score > results[1].score);
});

test("isHit breaks ordering when score is similar", () => {
  const results = searchSongs("summer night", [
    song({ title: "Summer Night", artist: "Alpha", isHit: false }),
    song({ title: "Summer Night", artist: "Zeta", isHit: true })
  ]);

  assert.equal(results[0]?.song.artist, "Zeta");
});

test("limit works", () => {
  const results = searchSongs("love", [
    song({ title: "Love One", artist: "A" }),
    song({ title: "Love Two", artist: "B" }),
    song({ title: "Love Three", artist: "C" })
  ], { limit: 2 });

  assert.equal(results.length, 2);
});

test("source filter works", () => {
  const results = searchSongs("dancing queen", [
    song({ title: "Dancing Queen", artist: "ABBA", source: "ising" }),
    song({ title: "Dancing Queen", artist: "ABBA", source: "karafun" })
  ], { source: "karafun" });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.song.source, "karafun");
});

test("search module does not perform HTTP requests", () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("search must not call fetch");
  }) as typeof fetch;

  try {
    const results = searchSongs("krolowa lez", fixtureSongs());
    assert.equal(results[0]?.song.title, "Królowa Łez");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing local song index gives a readable error", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "song-index-"));
  try {
    const missingPath = join(tempDir, "missing.json");

    await assert.rejects(() => readLocalSongIndex(missingPath), MissingLocalSongIndexError);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function fixtureSongs(): LocalSong[] {
  return [
    song({ artist: "Agnieszka Chylińska", title: "Królowa Łez", isHit: true, sourceUrl: "https://ising.pl/agnieszka-chylinska-krolowa-lez-piosenka" }),
    song({ artist: "2+1", title: "Chodź, pomaluj mój świat", sourceUrl: "https://ising.pl/2-plus-1-chodz-pomaluj-moj-swiat-piosenka" }),
    song({ artist: "ABBA", title: "Dancing Queen", sourceUrl: "https://ising.pl/abba-dancing-queen-piosenka" }),
    song({ artist: "*NSYNC", title: "Bye Bye Bye", sourceUrl: "https://ising.pl/nsync-bye-bye-bye-piosenka" })
  ];
}

function song(overrides: Partial<LocalSong> & { source?: "ising" | "karafun" } = {}): LocalSong {
  const source = overrides.source ?? "ising";
  const artist = overrides.artist ?? "Artist";
  const title = overrides.title ?? "Title";
  const subtitle = overrides.subtitle ?? null;
  const genres = overrides.genres ?? ["Pop"];
  const normalizedArtist = normalizeFixtureText(artist);
  const normalizedTitle = normalizeFixtureText(title);
  const searchText = overrides.searchText ?? normalizeFixtureText([artist, title, subtitle, ...genres].filter(Boolean).join(" "));

  return {
    source,
    sourceSongId: overrides.sourceSongId ?? `${source}-${artist}-${title}`,
    title,
    subtitle,
    artist,
    artistSourceId: overrides.artistSourceId ?? null,
    normalizedTitle,
    normalizedArtist,
    searchText,
    durationSeconds: overrides.durationSeconds ?? null,
    genres,
    isPlus: overrides.isPlus ?? false,
    isHit: overrides.isHit ?? false,
    isBuyAvailable: overrides.isBuyAvailable ?? false,
    sourceUrl: overrides.sourceUrl ?? null,
    sourceSelflink: overrides.sourceSelflink ?? null,
    sourceDateAdded: overrides.sourceDateAdded ?? null,
    availabilityStatus: "available",
    lastSeenAt: overrides.lastSeenAt ?? "2026-05-28T00:00:00.000Z",
    lastCheckedAt: overrides.lastCheckedAt ?? "2026-05-28T00:00:00.000Z"
  };
}

function normalizeFixtureText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
