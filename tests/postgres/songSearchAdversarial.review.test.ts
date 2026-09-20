import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import type postgres from "postgres";
import { test, vi } from "vitest";

import { normalizeSongSearchQuery, normalizeSongSearchText } from "../../src/lib/song-search.ts";
import { decodeSongSearchCursor } from "../../src/lib/song-search-cursor.ts";
import {
  applyPostgresMigrations,
  createPostgresTestClient,
  installPostgresCompatibilityFixture,
  removePostgresTestHarness,
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "./postgresTestHarness.ts";

vi.mock("server-only", () => ({}));

test("adversarial search review", async () => {
  const harness = await startPostgresTestHarness("pozanuta-search-review", "postgres:15-alpine");
  const sql = createPostgresTestClient(harness, "postgres", 4);

  try {
    await installPostgresCompatibilityFixture(sql);
    await applyPostgresMigrations(sql, 27);
    await seedTargets(sql);

    await withApplicationDatabase(harness, async () => {
      const { searchCatalogSongs } = await import("../../src/server/song-search.ts");
      const searchItems = async (query: string) =>
        (await searchCatalogSongs(query)).items;
      const typoCases = [
        ["bohemian rapsody", "Bohemian Rhapsody", "Queen"],
        ["bohemain rhapsody", "Bohemian Rhapsody", "Queen"],
        ["dancin queen", "Dancing Queen", "ABBA"],
        ["dancing quuen", "Dancing Queen", "ABBA"],
        ["lady gga", "Poker Face", "Lady Gaga"],
        ["ladi gaga", "Poker Face", "Lady Gaga"],
        ["pokerface", "Poker Face", "Lady Gaga"],
        ["poker-face", "Poker Face", "Lady Gaga"],
        ["guns n roses", "Sweet Child O' Mine", "Guns N' Roses"],
        ["guns and roses", "Sweet Child O' Mine", "Guns N' Roses"],
      ] as const;
      const tokenCases = [
        ["queen bohemian", "Bohemian Rhapsody", "Queen"],
        ["bohemian queen", "Bohemian Rhapsody", "Queen"],
        ["queen rhapsody", "Bohemian Rhapsody", "Queen"],
        ["rhapsody queen", "Bohemian Rhapsody", "Queen"],
        ["gaga poker", "Poker Face", "Lady Gaga"],
        ["poker gaga", "Poker Face", "Lady Gaga"],
        ["dancing abba", "Dancing Queen", "ABBA"],
        ["abba queen", "Dancing Queen", "ABBA"],
        ["queen queen bohemian", "Bohemian Rhapsody", "Queen"],
        ["  queen   bohemian  ", "Bohemian Rhapsody", "Queen"],
      ] as const;

      for (const [rawQuery, title, artist] of [...typoCases, ...tokenCases]) {
        const query = normalizeSongSearchQuery(rawQuery);
        const results = await searchItems(query);
        const rank = results.findIndex((song) => song.title === title && song.artist === artist) + 1;
        assert.equal(
          rank,
          1,
          `${rawQuery}: expected ${artist} — ${title} at rank 1`,
        );
        console.info(`REVIEW_RANK ${JSON.stringify({ rawQuery, query, rank, top: results.slice(0, 3).map((song) => `${song.artist} — ${song.title}`) })}`);
      }

      const [defaultThreshold] = await sql<{ threshold: string }[]>`SELECT current_setting('pg_trgm.strict_word_similarity_threshold') AS threshold`;
      await sql`ALTER DATABASE postgres SET pg_trgm.strict_word_similarity_threshold = 0.99`;
      const applicationDatabase = getApplicationDatabase();
      if (applicationDatabase) await applicationDatabase.$client.end({ timeout: 5 });
      clearApplicationDatabase();
      const highThresholdResults = await searchItems("pokerface");
      const highThresholdDatabase = getApplicationDatabase();
      if (highThresholdDatabase) await highThresholdDatabase.$client.end({ timeout: 5 });
      clearApplicationDatabase();
      await sql`ALTER DATABASE postgres SET pg_trgm.strict_word_similarity_threshold = 0.5`;
      assert.equal(
        highThresholdResults.findIndex(
          (song) => song.title === "Poker Face" && song.artist === "Lady Gaga",
        ) + 1,
        1,
        "the application-owned threshold must override a surrounding 0.99 default",
      );
      console.info(`REVIEW_THRESHOLD ${JSON.stringify({ defaultThreshold: defaultThreshold?.threshold, highThresholdRank: highThresholdResults.findIndex((song) => song.title === "Poker Face" && song.artist === "Lady Gaga") + 1 })}`);

      await seedBroadFindability(sql);
      const broad = await searchItems("love");
      const allBroad = await collectAllSearchItems(searchCatalogSongs, "love");
      const specific = await searchItems("zzz intended love");
      assert.equal(broad.length, 50);
      assert.equal(broad.findIndex((song) => song.artist === "ZZZ Intended"), -1);
      assert.equal(allBroad.items.length, 66);
      assert.equal(new Set(allBroad.items.map((song) => song.id)).size, 66);
      assert.equal(allBroad.items.findIndex((song) => song.artist === "ZZZ Intended") + 1, 66);
      assert.equal(specific.findIndex((song) => song.artist === "ZZZ Intended") + 1, 1);
      console.info(`REVIEW_FINDABILITY ${JSON.stringify({ broadCount: broad.length, totalReachable: allBroad.items.length, pages: allBroad.pages, intendedBroadPageOneRank: broad.findIndex((song) => song.artist === "ZZZ Intended") + 1, intendedOverallRank: allBroad.items.findIndex((song) => song.artist === "ZZZ Intended") + 1, intendedSpecificRank: specific.findIndex((song) => song.artist === "ZZZ Intended") + 1 })}`);

      await seedVariantPressure(sql);
      const variants = await searchItems("night");
      const uniqueIdentities = new Set(variants.map((song) => `${song.artist}\u0000${song.title}`));
      const allVariants = await collectAllSearchItems(searchCatalogSongs, "night");
      assert.equal(variants.length, 50);
      assert.equal(uniqueIdentities.size, 17);
      assert.equal(variants.findIndex((song) => song.artist === "ZZZ Unique"), -1);
      assert.equal(allVariants.items.length, 62);
      assert.equal(new Set(allVariants.items.map((song) => song.id)).size, 62);
      assert.equal(allVariants.items.findIndex((song) => song.artist === "ZZZ Unique") + 1, 61);
      console.info(`REVIEW_VARIANTS ${JSON.stringify({ returned: variants.length, uniqueIdentities: uniqueIdentities.size, totalReachable: allVariants.items.length, pages: allVariants.pages, desiredPageOneRank: variants.findIndex((song) => song.artist === "ZZZ Unique") + 1, desiredOverallRank: allVariants.items.findIndex((song) => song.artist === "ZZZ Unique") + 1 })}`);

      for (const [query, count] of [["baby", 105], ["heart", 155]] as const) {
        await seedPaginationFixture(sql, query, count);
        const traversal = await collectAllSearchItems(searchCatalogSongs, query);
        assert.equal(traversal.items.length, count);
        assert.equal(new Set(traversal.items.map((song) => song.id)).size, count);
        console.info(`REVIEW_PAGINATION ${JSON.stringify({ query, expected: count, reached: traversal.items.length, pages: traversal.pages })}`);
      }

      for (const total of [5_000, 25_000, 50_000, 100_000]) {
        await resizeScale(sql, total);
        for (const [kind, query] of [["exact", "hello"], ["multi", "poker face lady gaga"], ["typo", "bohemian rapsody"], ["broad", "rock"]] as const) {
          const startedAt = performance.now();
          const results = await searchItems(query);
          const milliseconds = Number((performance.now() - startedAt).toFixed(2));
          const candidateCount = await countBoundedCandidates(sql, query);
          const branchMatchRows = await countBranchMatches(sql, query);
          assert.ok(results.length <= 50, `${kind} must keep the response page bounded`);
          assert.ok(candidateCount <= 500, `${kind} scored ${candidateCount} final candidates`);
          if (kind !== "broad") {
            assert.ok(
              candidateCount <= 2,
              `${kind} should score only selective candidates, received ${candidateCount}`,
            );
          }
          console.info(`REVIEW_SCALE ${JSON.stringify({ totalRows: await totalRows(sql), kind, query, milliseconds, branchMatchRows, candidateCount, finalScoredRows: candidateCount, returnedRows: results.length })}`);
        }

        const plan = await explainCandidatePlan(sql, "bohemian rapsody");
        assert.match(plan, /Bitmap Index Scan on songs_search_text_trgm_idx/);
        assert.doesNotMatch(plan, /Seq Scan on songs/);
        console.info(`REVIEW_PLAN ${JSON.stringify({ totalRows: await totalRows(sql), query: "bohemian rapsody", plan })}`);
        if (total === 100_000) {
          let pageCursor = null;
          const pageTimes = [];
          for (let pageNumber = 1; pageNumber <= 3; pageNumber += 1) {
            const pageStartedAt = performance.now();
            const page = await searchCatalogSongs("rock", pageCursor);
            pageTimes.push({
              page: pageNumber,
              milliseconds: Number((performance.now() - pageStartedAt).toFixed(2)),
              returnedRows: page.items.length,
            });
            pageCursor = page.nextCursor
              ? decodeSongSearchCursor(page.nextCursor, "rock")
              : null;
            assert.ok(pageCursor, `rock page ${pageNumber} must have a continuation`);
          }
          assert.deepEqual(pageTimes.map(({ returnedRows }) => returnedRows), [50, 50, 50]);
          const firstPageMilliseconds = pageTimes[0]?.milliseconds ?? 0;
          assert.ok(
            pageTimes.every(
              ({ milliseconds }) => milliseconds <= firstPageMilliseconds * 4,
            ),
            "bounded cursor continuation must not degrade catastrophically",
          );
          console.info(`REVIEW_PAGE_SCALE ${JSON.stringify({ totalRows: await totalRows(sql), query: "rock", pages: pageTimes })}`);
          const branchPlans = {
            fuzzy: await explainPlan(sql, "fuzzy"),
            phrase: await explainPlan(sql, "phrase"),
            union: await explainPlan(sql, "union"),
          };
          for (const [kind, branchPlan] of Object.entries(branchPlans)) {
            assert.match(
              branchPlan,
              /Bitmap Index Scan on songs_search_text_trgm_idx/,
              `${kind} branch must use the trigram GIN index`,
            );
            assert.doesNotMatch(branchPlan, /Seq Scan on songs/);
          }
          console.info(`REVIEW_PLAN_BRANCHES ${JSON.stringify(branchPlans)}`);
        }
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }
}, 300_000);

async function insertSong(sql: postgres.Sql, input: { source?: "ising" | "karafun" | "manual"; sourceId: string | null; title: string; artist: string; metadata?: string }) {
  const title = normalizeSongSearchText(input.title);
  const artist = normalizeSongSearchText(input.artist);
  const searchText = normalizeSongSearchText(`${input.artist} ${input.title} ${input.metadata ?? "karaoke english"}`);
  await sql`
    INSERT INTO songs (source, source_song_id, title, artist, normalized_title, normalized_artist, search_text)
    VALUES (${input.source ?? "manual"}, ${input.sourceId}, ${input.title}, ${input.artist}, ${title}, ${artist}, ${searchText})
  `;
}

async function seedTargets(sql: postgres.Sql) {
  await insertSong(sql, { sourceId: "queen", title: "Bohemian Rhapsody", artist: "Queen" });
  await insertSong(sql, { sourceId: "abba", title: "Dancing Queen", artist: "ABBA" });
  await insertSong(sql, { sourceId: "gaga", title: "Poker Face", artist: "Lady Gaga" });
  await insertSong(sql, { sourceId: "guns", title: "Sweet Child O' Mine", artist: "Guns N' Roses" });
  await insertSong(sql, { sourceId: "hello", title: "Hello", artist: "Adele" });
  await insertSong(sql, { sourceId: "fuzzy-decoy-1", title: "Bohemian Dream", artist: "Rhapsody Lane" });
  await insertSong(sql, { sourceId: "fuzzy-decoy-2", title: "Poker Faces", artist: "Lady Grey" });
  await insertSong(sql, { sourceId: "fuzzy-decoy-3", title: "Dancing Night", artist: "Queen Bee" });
}

async function seedBroadFindability(sql: postgres.Sql) {
  for (let index = 1; index <= 65; index += 1) {
    await insertSong(sql, { sourceId: `love-${index}`, title: "Love", artist: `Artist ${String(index).padStart(3, "0")}` });
  }
  await insertSong(sql, { sourceId: "love-intended", title: "Love", artist: "ZZZ Intended" });
}

async function seedVariantPressure(sql: postgres.Sql) {
  for (let index = 1; index <= 20; index += 1) {
    const artist = `Variant Artist ${String(index).padStart(2, "0")}`;
    for (const source of ["ising", "karafun", "manual"] as const) {
      await insertSong(sql, { source, sourceId: source === "manual" ? null : `night-${source}-${index}`, title: "Night", artist });
    }
  }
  await insertSong(sql, { sourceId: "night-unique", title: "Night", artist: "ZZZ Unique" });
}

async function seedPaginationFixture(sql: postgres.Sql, title: string, count: number) {
  for (let index = 1; index <= count; index += 1) {
    const source = (["ising", "karafun", "manual"] as const)[(index - 1) % 3];
    await insertSong(sql, {
      source,
      sourceId: source === "manual" ? null : `${title}-${source}-${index}`,
      title,
      artist: `Paged Artist ${String(index).padStart(3, "0")}`,
    });
  }
}

async function collectAllSearchItems(
  search: typeof import("../../src/server/song-search.ts").searchCatalogSongs,
  query: string,
) {
  const items: Awaited<ReturnType<typeof search>>["items"] = [];
  let cursor: Awaited<ReturnType<typeof decodeSongSearchCursor>> = null;
  let pages = 0;

  do {
    const page = await search(query, cursor);
    items.push(...page.items);
    pages += 1;
    assert.ok(pages <= 20, "search pagination must remain bounded");
    cursor = page.nextCursor
      ? decodeSongSearchCursor(page.nextCursor, query)
      : null;
    if (page.nextCursor) {
      assert.ok(
        cursor,
        `next cursor must decode: ${Buffer.from(page.nextCursor, "base64url").toString("utf8")}`,
      );
    }
  } while (cursor);

  return { items, pages };
}

async function resizeScale(sql: postgres.Sql, target: number) {
  const [current] = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM songs WHERE source_song_id LIKE 'scale-%'`;
  const from = (current?.count ?? 0) + 1;
  if (from > target) return;
  await sql`
    INSERT INTO songs (source, source_song_id, title, artist, normalized_title, normalized_artist, search_text)
    SELECT 'manual', 'scale-' || value, 'Scale Song ' || value, 'Scale Artist ' || value,
      'scale song ' || value, 'scale artist ' || value,
      CASE WHEN value % 2 = 0 THEN 'scale artist scale song rock english' ELSE 'scale artist scale song pop english' END
    FROM generate_series(${from}::integer, ${target}::integer) AS value
  `;
  await sql`VACUUM ANALYZE songs`;
}

async function countBoundedCandidates(sql: postgres.Sql, query: string) {
  let tokenFilter: ReturnType<typeof sql>;
  if (query === "poker face lady gaga") {
    tokenFilter = sql`search_text ILIKE '%poker%' AND search_text ILIKE '%face%' AND search_text ILIKE '%lady%' AND search_text ILIKE '%gaga%'`;
  } else if (query === "bohemian rapsody") {
    tokenFilter = sql`search_text ILIKE '%bohemian%' AND search_text ILIKE '%rapsody%'`;
  } else {
    tokenFilter = sql`search_text ILIKE ${`%${query}%`}`;
  }

  const [row] = await sql<{ count: number }[]>`
    WITH strong AS MATERIALIZED (
      (SELECT id FROM songs WHERE normalized_title = ${query} LIMIT 500)
      UNION
      (SELECT id FROM songs WHERE normalized_artist = ${query} LIMIT 500)
      UNION
      (SELECT id FROM songs WHERE search_text ILIKE ${`%${query}%`} LIMIT 500)
      UNION
      (SELECT id FROM songs WHERE ${tokenFilter} LIMIT 500)
    ), fuzzy AS MATERIALIZED (
      SELECT id FROM songs
      WHERE search_text %>> ${query}
        AND (SELECT count(*) FROM strong) < 100
      LIMIT 200
    ), candidates AS (
      SELECT id FROM strong
      UNION
      SELECT id FROM fuzzy
    )
    SELECT count(*)::integer AS count FROM candidates
  `;
  return row?.count ?? 0;
}

async function countBranchMatches(sql: postgres.Sql, query: string) {
  let rows: { count: number }[];
  if (query === "poker face lady gaga") {
    rows = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM songs WHERE search_text ILIKE '%poker face lady gaga%' OR (search_text ILIKE '%poker%' AND search_text ILIKE '%face%' AND search_text ILIKE '%lady%' AND search_text ILIKE '%gaga%') OR search_text %>> ${query}`;
  } else if (query === "bohemian rapsody") {
    rows = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM songs WHERE search_text ILIKE '%bohemian rapsody%' OR (search_text ILIKE '%bohemian%' AND search_text ILIKE '%rapsody%') OR search_text %>> ${query}`;
  } else {
    rows = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM songs WHERE search_text ILIKE ${`%${query}%`} OR search_text %>> ${query}`;
  }
  return rows[0]?.count ?? 0;
}

async function explainCandidatePlan(sql: postgres.Sql, query: string) {
  const rows = await sql<{ "QUERY PLAN": string }[]>`
    EXPLAIN (ANALYZE, BUFFERS)
    WITH phrase AS MATERIALIZED (
      SELECT id FROM songs WHERE search_text ILIKE '%bohemian rapsody%' LIMIT 500
    ), tokens AS MATERIALIZED (
      SELECT id FROM songs
      WHERE search_text ILIKE '%bohemian%' AND search_text ILIKE '%rapsody%'
      LIMIT 500
    ), fuzzy AS MATERIALIZED (
      SELECT id FROM songs WHERE search_text %>> ${query} LIMIT 200
    ), candidates AS (
      SELECT id FROM phrase
      UNION SELECT id FROM tokens
      UNION SELECT id FROM fuzzy
    )
    SELECT id FROM candidates LIMIT 51
  `;
  return rows.map((row) => row["QUERY PLAN"]).join(" | ");
}

async function explainPlan(sql: postgres.Sql, kind: "fuzzy" | "phrase" | "union") {
  let rows: { "QUERY PLAN": string }[];
  if (kind === "fuzzy") {
    rows = await sql<{ "QUERY PLAN": string }[]>`EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM songs WHERE search_text %>> ${"bohemian rapsody"} LIMIT 50`;
  } else if (kind === "phrase") {
    rows = await sql<{ "QUERY PLAN": string }[]>`EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM songs WHERE search_text ILIKE ${"%bohemian rapsody%"} LIMIT 50`;
  } else {
    rows = await sql<{ "QUERY PLAN": string }[]>`EXPLAIN (ANALYZE, BUFFERS) WITH candidates AS MATERIALIZED (
      SELECT id FROM songs WHERE search_text ILIKE ${"%bohemian rapsody%"}
      UNION
      SELECT id FROM songs WHERE search_text ILIKE ${"%bohemian%"} AND search_text ILIKE ${"%rapsody%"}
      UNION
      SELECT id FROM songs WHERE search_text %>> ${"bohemian rapsody"}
    ) SELECT id FROM candidates LIMIT 50`;
  }
  return rows.map((row) => row["QUERY PLAN"]).join(" | ");
}

async function totalRows(sql: postgres.Sql) {
  const [row] = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM songs`;
  return row?.count ?? 0;
}

async function withApplicationDatabase<T>(harness: PostgresTestHarness, action: () => Promise<T>) {
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

type ApplicationDatabase = { $client: { end(options: { timeout: number }): Promise<void> } };
function getApplicationDatabase() {
  return (globalThis as typeof globalThis & { pozaNutaDatabase?: ApplicationDatabase }).pozaNutaDatabase;
}
function clearApplicationDatabase() {
  delete (globalThis as typeof globalThis & { pozaNutaDatabase?: ApplicationDatabase }).pozaNutaDatabase;
}
