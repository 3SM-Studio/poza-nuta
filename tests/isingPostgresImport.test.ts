import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadISingImportOptions } from "../src/db/import-ising.ts";
import {
  createISingMetadataEnrichment,
  runISingImportAdapter,
  type ISingImportOptions,
} from "../src/db/ising-import-adapter.ts";
import { readAndValidateISingResponse } from "../src/db/ising-client.ts";
import {
  mapISingSongToSong,
  type ISingApiSong,
} from "../src/db/ising-mapping.ts";

const checkedAt = new Date("2026-08-18T12:00:00.000Z");

test("legacy iSing CLI remains dry-run-only while the worker owns writes", () => {
  const cliSource = readFileSync("src/db/import-ising.ts", "utf8");
  const adapterSource = readFileSync(
    "src/db/ising-import-adapter.ts",
    "utf8",
  );

  assert.match(cliSource, /runISingImportAdapter\(options\)/);
  assert.match(cliSource, /Direct iSing writes are disabled/);
  assert.doesNotMatch(cliSource, /DATABASE_URL|createISingImportJob/);
  assert.match(adapterSource, /createISingSongBatchWriter/);
  assert.match(adapterSource, /\.onConflictDoUpdate\(/);
  assert.match(
    adapterSource,
    /type SongDatabase = Pick<PostgresJsDatabase, "insert" \| "select">/,
  );
  assert.doesNotMatch(
    adapterSource,
    /\b(?:database|transaction)\.delete\(\s*songs\s*\)/,
  );
  assert.doesNotMatch(
    adapterSource,
    /\bDELETE\s+FROM\s+(?:public\.)?"?songs"?\b|\bTRUNCATE(?:\s+TABLE)?\s+(?:public\.)?"?songs"?\b/i,
  );
});

test("base mapper uses only live iSing fields plus complete membership enrichment", () => {
  const enrichment = createISingMetadataEnrichment(
    [{ canonicalLanguage: "Polish", sourceSongIds: ["9053"] }],
    ["9053"],
  );
  const song = mapISingSongToSong(
    sampleSong({
      language: "pretend-language",
      languages: ["pretend-language"],
      duet: false,
      is_duet: false,
      sample_url: "https://example.test/sample.mp3",
      raw_metadata: { source: "fixture" },
    }),
    checkedAt,
    enrichment,
  );

  assert.deepEqual(song, {
    source: "ising",
    sourceSongId: "9053",
    title: "Królowa Łez",
    artist: "Agnieszka Chylińska",
    normalizedTitle: "krolowa lez",
    normalizedArtist: "agnieszka chylinska",
    searchText: "agnieszka chylinska krolowa lez pop rock polish duet duo plus hit",
    durationSeconds: 245,
    genres: ["Pop", "Rock"],
    languages: ["Polish"],
    isDuet: true,
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

test("iSing dry-run completes memberships without persisting to the database", async () => {
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
      fetchFn: async (input) => {
        const url = new URL(String(input));
        const language = url.searchParams.get("lang");
        const tag = url.searchParams.get("tag");
        if (language === "pl") return jsonResponse(pageResponse([sampleSong()]));
        if (language === "-pl" || tag === "duet") {
          return jsonResponse(pageResponse([]));
        }
        return jsonResponse(pageResponse([sampleSong()]));
      },
      persistBatch: async () => {
        persistCalled = true;
        throw new Error("dry-run must not persist");
      },
    },
  );

  assert.equal(persistCalled, false);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.summary.processed, 1);
  assert.equal(outcome.diagnostics?.enrichmentStatus, "complete");
  assert.equal(outcome.diagnostics?.mappedMetadata.songsWithLanguages, 1);
});

test("iSing safety allows aggregate count fields and rejects private recording fields", async () => {
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
    "https://api.ising.pl/v2/search?client_id=secret",
  );
  assert.equal(parsed.data.results.songs.length, 1);

  await assert.rejects(
    () =>
      readAndValidateISingResponse(
        jsonResponse(pageResponse([sampleSong({ recordings: [{ id: 1 }] })])),
        "https://api.ising.pl/v2/search?client_id=secret",
      ),
    /Unexpected private\/sensitive iSing field/,
  );
});

test("iSing safety rejects lyrics, audio, and media payloads", async () => {
  for (const unsafeField of [
    "lyrics",
    "audio",
    "audio_url",
    "media_url",
  ] as const) {
    await assert.rejects(
      () =>
        readAndValidateISingResponse(
          jsonResponse(pageResponse([sampleSong({ [unsafeField]: "unsafe" })])),
          "https://api.ising.pl/v2/search?client_id=secret",
        ),
      /Unexpected private\/sensitive iSing field/,
    );
  }
});

test("iSing CLI parser accepts standalone double dash and refuses direct writes", () => {
  const direct = loadISingImportOptions(testEnv(), [
    "--dry-run",
    "--limit",
    "20",
  ]);
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
  assert.throws(
    () => loadISingImportOptions(testEnv(), ["--limit", "1"]),
    /Direct iSing writes are disabled/,
  );
});

function sampleSong(overrides: Record<string, unknown> = {}): ISingApiSong {
  return {
    id: 9053,
    title: "Królowa Łez",
    subtitle: null,
    artist: "Agnieszka Chylińska",
    duration: 245,
    genre: ["Pop", "Rock"],
    plus: true,
    hit: true,
    permalink: "https://ising.pl/agnieszka-chylinska-krolowa-lez-piosenka",
    links: {
      selflink: "https://api.ising.pl/v2/songs/9053",
    },
    ...overrides,
  };
}

function pageResponse(songs: unknown[]) {
  return {
    data: {
      found: songs.length,
      q: "",
      results: {
        songs,
      },
    },
    links: {},
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
