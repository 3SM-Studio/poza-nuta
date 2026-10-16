import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { cpus, totalmem, platform } from "node:os";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../src/db/schema.ts";
import { test, vi } from "vitest";
import { normalizeSongSearchText, normalizeLegacySongSearchText, songSearchGrams } from "../../src/lib/song-search.ts";
import { decodeSongSearchCursor } from "../../src/lib/song-search-cursor.ts";
import { backfillUnicodeSongSearchBatch } from "../../src/db/song-search-backfill.ts";
import caseFold from "../../src/lib/unicode-case-fold.json" with { type: "json" };
import { multilingualSongs, trustedAliases } from "../fixtures/unicode-song-search.ts";
import { applyPostgresMigrations, applyPostgresMigration, createPostgresTestClient, installPostgresCompatibilityFixture, removePostgresTestHarness, startPostgresTestHarness } from "./postgresTestHarness.ts";

vi.mock("server-only", () => ({}));

test("Unicode search: additive migration, parity, backfill, imports, ranking, safety, scale and pagination on owned PG17", async () => {
  const harness = await startPostgresTestHarness("kunestu-unicode-search");
  const connection = createPostgresTestClient(harness, "postgres", 8);
  const priorUrl = process.env.DATABASE_URL, priorEngine = process.env.SONG_SEARCH_ENGINE;
  try {
    await installPostgresCompatibilityFixture(connection);
    await applyPostgresMigrations(connection, 30);
    const [{ version }] = await connection<{ version: number }[]>`select current_setting('server_version_num')::int as version`;
    assert.ok(version >= 170000 && version < 180000);
    // Existing non-ASCII songs really have lossy old projection fields.
    for (const song of multilingualSongs) await connection`insert into songs(source,title,artist,normalized_title,normalized_artist,search_text)
      values('manual',${song.title},${song.artist},${normalizeLegacySongSearchText(song.title)},${normalizeLegacySongSearchText(song.artist)},${normalizeLegacySongSearchText(song.title + " " + song.artist)})`;
    const original = await connection`select id::text, public_id, title, artist, normalized_title, normalized_artist, search_text from songs order by id`;
    await applyPostgresMigration(connection, 31);
    assert.equal((await connection`select * from song_search_documents`).length, 0, "expand must not eagerly rewrite the catalog");
    const database = drizzle(connection);
    assert.equal(await backfillUnicodeSongSearchBatch(database, 5), 5);
    let written = 5, batch;
    do { batch = await backfillUnicodeSongSearchBatch(database, 5); written += batch; } while (batch);
    assert.equal(written, multilingualSongs.length);
    assert.equal(await backfillUnicodeSongSearchBatch(database, 5), 0, "idempotent resume");
    assert.deepEqual(await connection`select id::text, public_id, title, artist, normalized_title, normalized_artist, search_text from songs order by id`, original);

    const compatibilityCases: string[] = [];
    for (let point = 1; point <= 0x10ffff; point++) {
      if (point >= 0xac00 && point <= 0xd7a3) continue;
      const value=String.fromCodePoint(point);
      if (value !== value.normalize("NFKD")) compatibilityCases.push(value);
    }
    const corpus = [...multilingualSongs.flatMap(song => [song.title, song.artist]), ...Object.keys(caseFold), ...compatibilityCases,
      ...compatibilityCases.map(value => value.normalize("NFKD")), "שָׁלוֹם", "عَمْرُو", "कि", "กิ", "👩‍🎤Café １２３", "\u200eКино\u202e", "𠀀", "क्‍ष", "a\u00a0b"];
    const parity = await connection<{ input: string; normalized: string; grams: string[] }[]>`
      select input, public.kunestu_search_normalize_v2(input) normalized,
        public.kunestu_search_grams_v2(public.kunestu_search_normalize_v2(input)) grams from unnest(${corpus}::text[]) input`;
    for (const row of parity) {
      assert.equal(row.normalized, normalizeSongSearchText(row.input), `SQL/JS parity for ${JSON.stringify(row.input)}`);
      assert.deepEqual([...row.grams].sort(), songSearchGrams(row.normalized));
    }
    for (const alias of trustedAliases) await connection`insert into song_search_aliases(song_id,kind,value,provenance)
      select id,'artist',${alias.value},'Reviewed synthetic test alias' from songs where artist=${alias.artist}`;
    process.env.DATABASE_URL = `postgresql://postgres:${encodeURIComponent(harness.password)}@127.0.0.1:${harness.port}/postgres`;
    process.env.SONG_SEARCH_ENGINE = "unicode-v2";
    const capturedQueries: Array<{ query: string; params: unknown[] }> = [];
    const appClient = createPostgresTestClient(harness, "postgres", 2);
    const registry = globalThis as typeof globalThis & { pozaNutaDatabase?: ReturnType<typeof import("../../src/server/db.ts").getDb> };
    registry.pozaNutaDatabase = drizzle({ client: appClient, schema, logger: { logQuery(query, params) {
      if (query.includes("with exact_title")) capturedQueries[0] = { query, params };
    } } });
    const { searchCatalogSongs } = await import("../../src/server/song-search.ts");
    const search = (query: string) => searchCatalogSongs(normalizeSongSearchText(query));
    let successful = 0;
    for (const song of multilingualSongs) for (const query of song.queries) {
      const page = await search(query);
      const rank = page.items.findIndex(item => item.title === song.title && item.artist === song.artist);
      assert.ok(rank >= 0 && rank < 5, `${query}: expected ${song.artist} — ${song.title} in top five, got ${JSON.stringify(page.items.slice(0,5))}`);
      successful++;
    }
    for (const alias of trustedAliases) assert.ok((await search(alias.value)).items.some(song => song.artist === alias.artist));
    assert.equal((await search("несуществующийкаталогтестxyz")).items.length, 0);
    assert.equal((await search("unrelatedzzzxxyy")).items.length, 0);
    // Source upserts/updates and manual inserts go through the same trigger.
    const [newSong] = await connection<{ id: number }[]>`insert into songs(source,source_song_id,title,artist,normalized_title,normalized_artist,search_text)
      values('ising','unicode-update-fixture','Старий запис','Тестовий виконавець','','','') returning id::int`;
    await connection`insert into songs(source,source_song_id,title,artist,normalized_title,normalized_artist,search_text)
      values('ising','unicode-update-fixture','Новий запис','Тестовий виконавець','','','')
      on conflict(source,source_song_id) where source_song_id is not null do update set title=excluded.title`;
    assert.equal((await search("Новий запис")).items[0]?.id, newSong.id);
    assert.equal((await search("Старий запис")).items.some(song => song.id === newSong.id), false);
    await assert.rejects(connection.begin(async tx => { await tx`update songs set title='Rollback marker' where id=${newSong.id}`; throw new Error("intentional rollback"); }));
    assert.equal((await search("Новий запис")).items[0]?.id, newSong.id);
    // A real original spelling always outranks an alias on another rendition.
    await connection`insert into songs(source,title,artist,normalized_title,normalized_artist,search_text) values('manual','Kino','Original Artist','kino','original artist','kino original artist')`;
    assert.equal((await search("Kino")).items[0]?.title, "Kino");
    const permissions = await connection<{ tables: boolean; functions: boolean }[]>`select
      has_table_privilege('anon','song_search_documents','SELECT') or has_table_privilege('authenticated','song_search_aliases','INSERT') as tables,
      has_function_privilege('anon','kunestu_search_normalize_v2(text)','EXECUTE') as functions`;
    assert.deepEqual(Array.from(permissions), [{ tables: false, functions: false }]);
    console.info("UNICODE_SEARCH_CORRECTNESS " + JSON.stringify({ version, successful, aliases: trustedAliases.length, parity: parity.length }));

    const scaleStarted = performance.now();
    await connection`insert into songs(source,source_song_id,title,artist,normalized_title,normalized_artist,search_text)
      select 'manual','unicode-scale-'||n,'Fixture Song '||n,
        'Fixture Artist '||(n%2500)||case n%10 when 0 then ' 周' when 1 then ' Тест' when 2 then ' عمرو' when 3 then ' รัก' when 4 then ' 봄' else '' end,
        'fixture song '||n,'fixture artist '||(n%2500),'fixture song '||n||' fixture artist '||(n%2500)||' pop english' from generate_series(1,100000) n`;
    await connection`analyze songs`; await connection`analyze song_search_documents`; await connection`analyze song_search_aliases`;
    const scaleInsertMs = performance.now()-scaleStarted;
    const measurements = [];
    for (const query of ["Gorniak", "Dancing Queen", "dancin queen", "Кино", "عمرو دياب", "周", "光", "ab", "fi", "Fixture Song 90000", "unrelatedzzzxxyy"]) {
      await search(query);
      const samples = [];
      for (let run = 0; run < 7; run++) { const start=performance.now(); await search(query); samples.push(performance.now()-start); }
      samples.sort((a,b)=>a-b);
      process.env.SONG_SEARCH_ENGINE = "legacy";
      const legacyStart=performance.now();await search(query);const legacyMs=performance.now()-legacyStart;
      process.env.SONG_SEARCH_ENGINE = "unicode-v2";
      measurements.push({query,medianMs:samples[3],p95Ms:samples[6],legacySingleMs:legacyMs});
    }
    const concurrentlyStarted=performance.now(); await Promise.all(Array.from({length:20},(_,i)=>search(i%2 ? "周" : "Gorniak")));
    const concurrentMs=performance.now()-concurrentlyStarted;
    const heavyStarted=performance.now();
    const heavyPages=await Promise.all(Array.from({length:8},()=>search("Fixture Song 90000")));
    const concurrentHeavy8Ms=performance.now()-heavyStarted;
    for(const page of heavyPages) assert.deepEqual(page.items.map(song=>song.id),heavyPages[0].items.map(song=>song.id));
    const pageOne = await search("fixture"); assert.ok(pageOne.nextCursor);
    const next = decodeSongSearchCursor(pageOne.nextCursor, "fixture", 2); assert.ok(next);
    const pageTwo = await searchCatalogSongs("fixture", next);
    assert.equal(new Set([...pageOne.items,...pageTwo.items].map(song=>song.id)).size,100);
    assert.deepEqual(await search("Кино"), await search("Кино"));
    const plan = [];
    for (const query of ["周", "光", "fi"]) {
      await search(query);
      const captured = capturedQueries.at(-1); assert.ok(captured);
      const params = captured.params.map(value => {
        if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
        throw new Error("Unexpected non-scalar search SQL parameter.");
      });
      // Captured query is generated SQL; all untrusted values remain bound.
      plan.push({ query, plan: await connection.unsafe("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + captured.query, params) });
    }
    const artifact = { environment: {postgres:version,node:process.version,unicode:process.versions.unicode,cpu:cpus()[0].model,logicalCpus:cpus().length,ramGiB:totalmem()/2**30,platform:platform(),corpus:"100,000 synthetic scale rows, half with mixed-script artists (Han/Cyrillic/Arabic/Thai/Hangul), plus explicit multilingual fixtures; provider catalog files unavailable"},successful,aliases:trustedAliases.length,parity:parity.length,scaleInsertMs,measurements,concurrent20Ms:concurrentMs,concurrentHeavy8Ms,plan };
    writeFileSync('.artifacts/unicode-search-postgres-result.json',JSON.stringify(artifact,null,2));
    console.info("UNICODE_SEARCH_SCALE " + JSON.stringify({measurements,concurrentMs}));
  } finally {
    const app = (globalThis as typeof globalThis & { pozaNutaDatabase?: { $client: { end(options:{timeout:number}):Promise<void> } } });
    if(app.pozaNutaDatabase) await app.pozaNutaDatabase.$client.end({timeout:5}); delete app.pozaNutaDatabase;
    if(priorUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=priorUrl;
    if(priorEngine===undefined)delete process.env.SONG_SEARCH_ENGINE;else process.env.SONG_SEARCH_ENGINE=priorEngine;
    await connection.end({timeout:5}); await removePostgresTestHarness(harness.containerName);
  }
});
