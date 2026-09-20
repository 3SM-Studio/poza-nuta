import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import type postgres from "postgres";
import { test, vi } from "vitest";

import { normalizeSongSearchText } from "../../src/lib/song-search.ts";
import {
  applyPostgresMigrations,
  createPostgresTestClient,
  installPostgresCompatibilityFixture,
  removePostgresTestHarness,
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "./postgresTestHarness.ts";

vi.mock("server-only", () => ({}));

type QualitySong = {
  title: string;
  artist: string;
  queries: readonly string[];
  metadata?: string;
  maximumRank?: number;
};

const qualitySongs: readonly QualitySong[] = [
  { title: "Dancing Queen", artist: "ABBA", queries: ["Dancing Queen", "ABBA Dancing Queen", "Dancing Queen ABBA", "dancing abba", "queen dancing", "dancin queen"], maximumRank: 3 },
  { title: "Bohemian Rhapsody", artist: "Queen", queries: ["Bohemian Rhapsody", "Queen Bohemian", "Bohemian Queen", "Bohemian Rapsody"], maximumRank: 5 },
  { title: "Poker Face", artist: "Lady Gaga", queries: ["Lady Gaga Poker Face", "Poker Face Lady Gaga", "lady gaga poker", "Gaga Poker Face", "ladi gaga"], maximumRank: 5 },
  { title: "To nie ja", artist: "Edyta Górniak", queries: ["Górniak", "Gorniak", "Edyta Gorniak To nie ja", "to nie ja edyta"], maximumRank: 3 },
  { title: "Hello", artist: "Adele", queries: ["Hello", "Adele Hello", "Hello Adele"] },
  { title: "Hello", artist: "Lionel Richie", queries: ["Lionel Richie Hello", "Hello Lionel", "Richie Hello"] },
  { title: "Hey Jude", artist: "The Beatles", queries: ["Hey Jude", "Beatles Jude", "Jude Beatles"] },
  { title: "Let It Be", artist: "The Beatles", queries: ["Let It Be", "Beatles Let It", "let beatles"] },
  { title: "Billie Jean", artist: "Michael Jackson", queries: ["Billie Jean", "Jackson Billie", "Michael Billie Jean"] },
  { title: "Smells Like Teen Spirit", artist: "Nirvana", queries: ["Teen Spirit", "Nirvana Smells", "spirit nirvana"] },
  { title: "Don't Stop Believin'", artist: "Journey", queries: ["Dont Stop Believin", "Journey Dont Stop", "believin journey"] },
  { title: "Livin' on a Prayer", artist: "Bon Jovi", queries: ["Livin on a Prayer", "Bon Jovi Prayer", "prayer jovi"] },
  { title: "Girls Just Want to Have Fun", artist: "Cyndi Lauper", queries: ["Girls Just Want", "Cyndi Girls Fun", "lauper girls"] },
  { title: "I Wanna Dance with Somebody", artist: "Whitney Houston", queries: ["Dance with Somebody", "Whitney Dance", "somebody houston"] },
  { title: "The Final Countdown", artist: "Europe", queries: ["Final Countdown", "Europe Countdown", "countdown europe"] },
  { title: "Biała armia", artist: "Bajm", queries: ["Biała armia", "Biala Armia Bajm", "bajm biala"] },
  { title: "Kocham cię, kochanie moje", artist: "Maanam", queries: ["Kocham Cie Kochanie", "Maanam Kocham", "kochanie maanam"] },
  { title: "Nie płacz Ewka", artist: "Perfect", queries: ["Nie Placz Ewka", "Perfect Ewka", "ewka perfect"] },
  { title: "Whisky", artist: "Dżem", queries: ["Whisky", "Dzem Whisky", "whisky dzem"] },
  { title: "Polska", artist: "Kult", queries: ["Polska", "Kult Polska", "polska kult"] },
  { title: "Szampan", artist: "sanah", queries: ["Szampan", "sanah szampan", "szampan sanah"] },
  { title: "Małomiasteczkowy", artist: "Dawid Podsiadło", queries: ["Malomiasteczkowy", "Dawid Malomiasteczkowy", "podsiadlo malomiasteczkowy"] },
  { title: "Sweet Child O' Mine", artist: "Guns N' Roses", queries: ["Sweet Child O Mine", "Guns Roses Sweet Child", "child roses"] },
  { title: "Highway to Hell", artist: "AC/DC", queries: ["Highway to Hell", "AC DC Highway", "highway ac dc"] },
  { title: "Can't Help Falling in Love", artist: "Elvis Presley", queries: ["Cant Help Falling", "Elvis Falling Love", "falling presley"] },
  { title: "Fly Me to the Moon", artist: "Frank Sinatra", queries: ["Fly Me to the Moon", "Sinatra Fly Moon", "moon frank"] },
  { title: "Nothing Else Matters", artist: "Metallica", queries: ["Nothing Else Matters", "Metallica Nothing", "matters metallica"] },
  { title: "Losing My Religion", artist: "R.E.M.", queries: ["Losing My Religion", "R E M Losing", "religion rem"] },
  { title: "Zombie", artist: "The Cranberries", queries: ["Zombie", "Cranberries Zombie", "zombie cranberries"] },
  { title: "Take On Me", artist: "a-ha", queries: ["Take On Me", "A Ha Take", "take aha"] },
  { title: "Halo", artist: "Beyoncé", queries: ["Beyonce", "Beyonce Halo", "Halo Beyonce"] },
  { title: "99 Luftballons", artist: "Nena", queries: ["99 Luftballons", "Nena 99", "luftballons nena"] },
  { title: "Pop", artist: "Neon Trees", queries: ["Pop", "Neon Trees Pop", "pop neon"] },
  { title: "Midnight Echo", artist: "Nova", metadata: "pop english hit", queries: ["Midnight Echo", "Nova Midnight", "echo nova"] },
] as const;

const qualityCases = qualitySongs.flatMap((song) =>
  song.queries.map((query) => ({
    query,
    title: song.title,
    artist: song.artist,
    maximumRank: song.maximumRank ?? 3,
  })),
);

test("professional song search corpus ranks normal human queries prominently", async () => {
  assert.ok(qualityCases.length >= 100, `expected at least 100 quality cases, received ${qualityCases.length}`);
  const harness = await startPostgresTestHarness("pozanuta-song-search", "postgres:15-alpine");
  const sql = createPostgresTestClient(harness, "postgres", 4);

  try {
    await installPostgresCompatibilityFixture(sql);
    await applyPostgresMigrations(sql, 27);
    await seedSongs(sql);

    await withApplicationDatabase(harness, async () => {
      const { searchPublicSongs } = await import("../../src/server/public-api/service.ts");
      const { validateSearchQuery } = await import("../../src/server/public-api/validation.ts");
      const publicSearchRoute = await import("../../src/app/api/public/songs/search/route.ts");
      const searchItems = async (query: string) =>
        (await searchPublicSongs(query)).items;

      for (const qualityCase of qualityCases) {
        const validation = validateSearchQuery(qualityCase.query);
        assert.equal(validation.success, true, qualityCase.query);
        if (!validation.success || validation.data === null) continue;

        const results = await searchItems(validation.data);
        const index = results.findIndex(
          (song) => song.title === qualityCase.title && song.artist === qualityCase.artist,
        );
        assert.ok(
          index >= 0 && index + 1 <= qualityCase.maximumRank,
          `${qualityCase.query}: expected ${qualityCase.artist} — ${qualityCase.title} at rank <= ${qualityCase.maximumRank}, received ${index + 1 || "no result"}: ${results.slice(0, 5).map((song) => `${song.artist} — ${song.title}`).join(" | ")}`,
        );
      }

      const hello = await searchItems("hello");
      assert.equal(hello[0]?.title, "Hello");
      assert.equal(hello[1]?.title, "Hello");
      assert.ok(hello.every((song, index) => index < 2 || song.title !== "Hello"));

      const pop = await searchItems("pop");
      assert.equal(pop[0]?.title, "Pop", "exact title must outrank metadata-only matches");

      const dancingVariants = await searchItems("dancing queen abba");
      assert.deepEqual(
        dancingVariants.slice(0, 2).map(({ source }) => source),
        ["ising", "karafun"],
      );

      for (const unsupportedQuery of [
        "Кино",
        "Океан Ельзи",
        "Ляпис Трубецкой",
        "Μίκης Θεοδωράκης",
        "ØØ",
        "ßß",
        "🎤🎶",
        "---...!!!",
      ]) {
        const response = await publicSearchRoute.GET(
          new Request(
            `http://localhost/api/public/songs/search?q=${encodeURIComponent(unsupportedQuery)}`,
          ),
        );
        assert.equal(response.status, 200, unsupportedQuery);
        assert.deepEqual(await response.json(), {
          items: [],
          nextCursor: null,
        });
      }

      const measurements = [];
      for (const [kind, query] of [
        ["exact", "hello"],
        ["multi-token", "poker face lady gaga"],
        ["typo", "bohemian rapsody"],
        ["broad", "pop"],
      ] as const) {
        const startedAt = performance.now();
        const results = await searchItems(query);
        const milliseconds = Number((performance.now() - startedAt).toFixed(2));
        const candidateCount = await countMeasurementCandidates(sql, query);
        const apiStartedAt = performance.now();
        const response = await publicSearchRoute.GET(
          new Request(`http://localhost/api/public/songs/search?q=${encodeURIComponent(query)}`),
        );
        const responseBody = await response.text();
        const apiMilliseconds = Number((performance.now() - apiStartedAt).toFixed(2));
        assert.equal(response.status, 200);
        measurements.push({
          kind,
          milliseconds,
          apiMilliseconds,
          candidateCount,
          resultCount: results.length,
          payloadBytes: Buffer.byteLength(responseBody),
          logicalSearchOperations: 1,
          sqlStatementsPerSearch: 2,
        });
      }

      console.info(`SONG_SEARCH_LOCAL_QA ${JSON.stringify(measurements)}`);
    });

    const planRows = await sql<{ "QUERY PLAN": string }[]>`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT id
      FROM songs
      WHERE search_text ILIKE ${"%dancing queen%"}
         OR (search_text ILIKE ${"%dancing%"} AND search_text ILIKE ${"%queen%"})
         OR search_text %>> ${"dancing queen"}
      LIMIT 50
    `;
    console.info(`SONG_SEARCH_LOCAL_PLAN ${planRows.map((row) => row["QUERY PLAN"]).join(" | ")}`);
  } finally {
    await sql.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }
});

async function countMeasurementCandidates(sql: postgres.Sql, query: string) {
  if (query === "poker face lady gaga") {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM songs
      WHERE search_text ILIKE ${"%poker face lady gaga%"}
         OR (
           search_text ILIKE ${"%poker%"}
           AND search_text ILIKE ${"%face%"}
           AND search_text ILIKE ${"%lady%"}
           AND search_text ILIKE ${"%gaga%"}
         )
         OR search_text %>> ${query}
    `;
    return row?.count ?? 0;
  }

  if (query === "bohemian rapsody") {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM songs
      WHERE search_text ILIKE ${"%bohemian rapsody%"}
         OR (search_text ILIKE ${"%bohemian%"} AND search_text ILIKE ${"%rapsody%"})
         OR search_text %>> ${query}
    `;
    return row?.count ?? 0;
  }

  const pattern = `%${query}%`;
  const [row] = await sql<{ count: number }[]>`
    SELECT count(*)::integer AS count FROM songs
    WHERE search_text ILIKE ${pattern} OR search_text %>> ${query}
  `;
  return row?.count ?? 0;
}

async function seedSongs(sql: postgres.Sql) {
  let sourceIndex = 0;
  for (const song of qualitySongs) {
    sourceIndex += 1;
    const normalizedTitle = normalizeSongSearchText(song.title);
    const normalizedArtist = normalizeSongSearchText(song.artist);
    const searchText = normalizeSongSearchText(
      `${song.artist} ${song.title} ${song.metadata ?? "karaoke english"}`,
    );
    await sql`
      INSERT INTO songs (
        source, source_song_id, title, artist, normalized_title,
        normalized_artist, search_text
      ) VALUES (
        'karafun', ${`quality-${sourceIndex}`}, ${song.title}, ${song.artist},
        ${normalizedTitle}, ${normalizedArtist}, ${searchText}
      )
    `;
  }

  const dancingQueen = qualitySongs[0];
  assert.ok(dancingQueen);
  await sql`
    INSERT INTO songs (
      source, source_song_id, title, artist, normalized_title,
      normalized_artist, search_text
    ) VALUES (
      'ising', 'quality-dancing-variant', ${dancingQueen.title}, ${dancingQueen.artist},
      ${normalizeSongSearchText(dancingQueen.title)},
      ${normalizeSongSearchText(dancingQueen.artist)},
      ${normalizeSongSearchText(`${dancingQueen.artist} ${dancingQueen.title} karaoke english`)}
    )
  `;

  await sql`
    INSERT INTO songs (
      source, source_song_id, title, artist, normalized_title,
      normalized_artist, search_text
    )
    SELECT
      'manual',
      'scale-' || fixture_number,
      'Fixture Song ' || fixture_number,
      'Fixture Artist ' || fixture_number,
      'fixture song ' || fixture_number,
      'fixture artist ' || fixture_number,
      'fixture artist ' || fixture_number || ' fixture song ' || fixture_number || ' pop english'
    FROM generate_series(1, 5000) AS fixture_number
  `;
}

async function withApplicationDatabase<T>(
  harness: PostgresTestHarness,
  action: () => Promise<T>,
) {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `postgresql://postgres:${encodeURIComponent(harness.password)}@${harness.host}:${harness.port}/postgres`;
  clearApplicationDatabase();

  try {
    return await action();
  } finally {
    const database = getApplicationDatabase();
    if (database) await database.$client.end({ timeout: 5 });
    clearApplicationDatabase();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

type ApplicationDatabase = {
  $client: { end(options: { timeout: number }): Promise<void> };
};

function getApplicationDatabase() {
  return (
    globalThis as typeof globalThis & { pozaNutaDatabase?: ApplicationDatabase }
  ).pozaNutaDatabase;
}

function clearApplicationDatabase() {
  delete (
    globalThis as typeof globalThis & { pozaNutaDatabase?: ApplicationDatabase }
  ).pozaNutaDatabase;
}
