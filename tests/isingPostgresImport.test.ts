import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  loadISingImportOptions,
} from "../src/db/import-ising.ts";
import {
  runISingImportAdapter,
  type ISingImportOptions,
} from "../src/db/ising-import-adapter.ts";
import { readAndValidateISingResponse } from "../src/db/ising-client.ts";
import {
  mapISingSongToSong,
  type ISingApiSong,
} from "../src/db/ising-mapping.ts";

const checkedAt = new Date("2026-07-05T12:00:00.000Z");

test("legacy iSing CLI is a dry-run-only wrapper around the shared adapter", () => {
  const cliSource = readFileSync("src/db/import-ising.ts", "utf8");
  const adapterSource = readFileSync(
    "src/db/ising-import-adapter.ts",
    "utf8",
  );

  assert.match(cliSource, /runISingImportAdapter\(options\)/);
  assert.match(cliSource, /Direct iSing writes are disabled/);
  assert.doesNotMatch(cliSource, /DATABASE_URL|createISingImportJob/);
  assert.doesNotMatch(cliSource, /markISingImportJobSucceeded|markISingImportJobFailed/);
  assert.match(adapterSource, /\.onConflictDoUpdate\(/);
  assert.doesNotMatch(adapterSource, /\.delete\(|\btruncate\b/i);
});

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
  const outcome = await runISingImportAdapter(
    {
      ...testOptions(),
      mode: "dry_run",
      limit: 1,
    },
    {
      nowFn: () => checkedAt,
      delayFn: async () => {},
      fetchFn: async () => jsonResponse(pageResponse([sampleSong()])),
      persistBatch: async () => {
        persistCalled = true;
        throw new Error("dry-run must not persist");
      },
    },
  );

  assert.equal(persistCalled, false);
  assert.equal(outcome.status, "completed");
  const summary = outcome.summary;
  assert.equal(summary.processed, 1);
  assert.equal(summary.inserted, 1);
  assert.equal(summary.updated, 0);
  assert.equal(summary.skipped, 0);
});

test("iSing safety allows aggregate count fields", async () => {
  const parsed = await readAndValidateISingResponse(
    jsonResponse(
      pageResponse([
        sampleSong({
          recordings_count: 12,
          comments_count: 3,
          views_count: 1000,
          likes_count: 50,
          sample_url: "https://example.test/sample.mp3",
        }),
      ]),
    ),
    "https://api.ising.pl/v2/search",
  );

  assert.equal(parsed.data.results.songs.length, 1);
});

test("iSing safety rejects recordings payloads", async () => {
  await assert.rejects(
    () =>
      readAndValidateISingResponse(
        jsonResponse(
          pageResponse([
            sampleSong({
              recordings: [{ id: 1 }],
            }),
          ]),
        ),
        "https://api.ising.pl/v2/search",
      ),
    /Unexpected private\/sensitive iSing field/,
  );
});

test("iSing safety rejects lyrics, text and audio_url payloads", async () => {
  for (const unsafeField of ["lyrics", "text", "audio_url"] as const) {
    await assert.rejects(
      () =>
        readAndValidateISingResponse(
          jsonResponse(
            pageResponse([
              sampleSong({
                [unsafeField]: "unsafe",
              }),
            ]),
          ),
          "https://api.ising.pl/v2/search",
        ),
      /Unexpected private\/sensitive iSing field/,
    );
  }
});

test("iSing CLI parser accepts standalone double dash", () => {
  const direct = loadISingImportOptions(testEnv(), ["--dry-run", "--limit", "20"]);
  const withSeparator = loadISingImportOptions(testEnv(), [
    "--",
    "--dry-run",
    "--limit",
    "20",
  ]);

  assert.equal(direct.mode, "dry_run");
  assert.equal(direct.limit, 20);
  assert.equal(withSeparator.mode, "dry_run");
  assert.equal(withSeparator.limit, 20);
});

test("iSing legacy CLI rejects direct write mode", () => {
  assert.throws(
    () => loadISingImportOptions(testEnv(), ["--limit", "1"]),
    /Direct iSing writes are disabled/,
  );
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
    mode: "write",
    batchSize: 10,
    timeoutMs: 15_000,
  };
}

function testEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ISING_CLIENT_ID: "client-id",
    ISING_IMPORT_DELAY_MS: "1",
  };
}
