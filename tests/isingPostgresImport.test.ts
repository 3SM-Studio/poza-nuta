import assert from "node:assert/strict";
import test from "node:test";

import { runISingImport, type ISingImportOptions } from "../src/db/import-ising.ts";
import {
  mapISingSongToSong,
  type ISingApiSong,
} from "../src/db/ising-mapping.ts";

const checkedAt = new Date("2026-07-05T12:00:00.000Z");

test("mapISingSongToSong maps iSing metadata to songs insert payload", () => {
  const song = mapISingSongToSong(sampleSong(), checkedAt);

  assert.deepEqual(song, {
    source: "ising",
    sourceSongId: "9053",
    title: "Królowa Łez",
    artist: "Agnieszka Chylińska",
    normalizedTitle: "krolowa lez",
    normalizedArtist: "agnieszka chylinska",
    searchText: "agnieszka chylinska krolowa lez pop rock polish plus hit",
    durationSeconds: 245,
    genres: ["Pop", "Rock"],
    languages: ["Polish"],
    isDuet: false,
    isExplicit: false,
    isPlus: true,
    isHit: true,
    sourceUrl: "https://ising.pl/agnieszka-chylinska-krolowa-lez-piosenka",
    lastSeenAt: checkedAt,
    lastCheckedAt: checkedAt,
    createdAt: checkedAt,
    updatedAt: checkedAt,
  });
});

test("mapISingSongToSong skips records without a stable iSing id", () => {
  assert.equal(mapISingSongToSong({ ...sampleSong(), id: undefined }), null);
});

test("mapISingSongToSong normalizes title, artist and search text", () => {
  const song = mapISingSongToSong(
    {
      ...sampleSong(),
      title: " Wehikuł czasu! ",
      artist: " Dżem ",
      genre: ["Rock"],
      languages: [],
      plus: false,
      hit: false,
    },
    checkedAt,
  );

  assert.equal(song?.normalizedTitle, "wehikul czasu");
  assert.equal(song?.normalizedArtist, "dzem");
  assert.equal(song?.searchText, "dzem wehikul czasu rock");
});

test("iSing dry-run does not persist to the database", async () => {
  let persistCalled = false;
  const summary = await runISingImport(
    {
      ...testOptions(),
      dryRun: true,
      limit: 1,
    },
    {
      nowFn: () => checkedAt,
      delayFn: async () => {},
      fetchFn: async () => jsonResponse(pageResponse([sampleSong()])),
      persistBatchFn: async () => {
        persistCalled = true;
        throw new Error("dry-run must not persist");
      },
    },
  );

  assert.equal(persistCalled, false);
  assert.equal(summary.processed, 1);
  assert.equal(summary.inserted, 1);
  assert.equal(summary.updated, 0);
  assert.equal(summary.skipped, 0);
});

function sampleSong(overrides: ISingApiSong = {}): ISingApiSong {
  return {
    id: 9053,
    title: "Królowa Łez",
    subtitle: null,
    artist: "Agnieszka Chylińska",
    artist_id: 123,
    duration: 245,
    genre: ["Pop", "Rock"],
    languages: ["Polish"],
    plus: true,
    hit: true,
    buy: false,
    permalink: "https://ising.pl/agnieszka-chylinska-krolowa-lez-piosenka",
    links: {
      selflink: "https://api.ising.pl/v2/songs/9053",
    },
    ...overrides,
  };
}

function pageResponse(songs: ISingApiSong[], next?: string) {
  return {
    data: {
      found: songs.length,
      q: "",
      results: {
        songs,
      },
    },
    links: next ? { next } : {},
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
  });
}

function testOptions(): ISingImportOptions {
  return {
    apiBaseUrl: "https://api.ising.pl/v2",
    clientId: "client-id",
    delayMs: 1,
    tag: "",
    order: "-artist_string",
    limit: null,
    dryRun: false,
    batchSize: 10,
    timeoutMs: 15_000,
  };
}
