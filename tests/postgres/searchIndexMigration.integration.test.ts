import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/postgres-js";
import { test, vi } from "vitest";
import * as schema from "../../src/db/schema.ts";
import { applyPostgresMigration, applyPostgresMigrations, createPostgresTestClient, installPostgresCompatibilityFixture, removePostgresTestHarness, startPostgresTestHarness } from "./postgresTestHarness.ts";
vi.mock("server-only",()=>({}));

test("0034 upgrades populated 0033, preserves data/imports and permits code recovery without a destructive rollback",async()=>{
  const harness=await startPostgresTestHarness('kunestu-search-index');
  const db=createPostgresTestClient(harness,'postgres',2);
  const registry=globalThis as typeof globalThis & {pozaNutaDatabase?:ReturnType<typeof import('../../src/server/db.ts').getDb>};
  const previous=registry.pozaNutaDatabase;
  try{
    await installPostgresCompatibilityFixture(db);await applyPostgresMigrations(db,33);
    await db`insert into songs(source,source_song_id,title,artist,normalized_title,normalized_artist,search_text)
      select 'manual','migration-'||i,'Dancing Queen '||i,'ABBA','','','' from generate_series(1,250) i`;
    const before=await db`select id::text,public_id,title,artist,normalized_title,normalized_artist,search_text from songs order by id`;
    registry.pozaNutaDatabase=drizzle({client:db,schema});
    const {searchUnicodeCatalogSongs:current}=await import('../../src/server/song-search-unicode.ts');
    const {searchUnicodeCatalogSongs:baseline}=await import('../fixtures/song-search-unicode-baseline.ts');
    const priorPage=await baseline('danccing queeen',null);
    assert.ok(priorPage.items.length>0);
    await applyPostgresMigration(db,34);
    assert.deepEqual(await db`select id::text,public_id,title,artist,normalized_title,normalized_artist,search_text from songs order by id`,before);
    const [index]=await db`select i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) definition from pg_index i
      where i.indexrelid='public.song_search_documents_fuzzy_distance_idx'::regclass`;
    assert.equal(index.indisvalid,true);assert.equal(index.indisready,true);
    assert.match(index.definition,/USING gist/);assert.match(index.definition,/siglen='?256'?/);
    assert.deepEqual(await current('danccing queeen',null),priorPage);
    // Source upserts still maintain the existing Unicode projection and index.
    await db`insert into songs(source,source_song_id,title,artist,normalized_title,normalized_artist,search_text)
      values('manual','migration-1','Тиха ніч','Океан Ельзи','','','')
      on conflict(source,source_song_id) where source_song_id is not null do update set title=excluded.title,artist=excluded.artist`;
    assert.equal((await current('океан ельзи',null)).items[0]?.title,'Тиха ніч');
    // Explicitly owned disposable database: validate a recovery without deleting data.
    await db`drop index public.song_search_documents_fuzzy_distance_idx`;
    assert.deepEqual(await current('danccing queeen',null),await baseline('danccing queeen',null));
    await applyPostgresMigration(db,34);
    assert.equal((await db`select count(*)::int n from songs`)[0].n,250);
    const [permissions]=await db`select has_table_privilege('anon','song_search_documents','SELECT') anon,
      has_table_privilege('authenticated','song_search_documents','SELECT') authenticated`;
    assert.deepEqual(permissions,{anon:false,authenticated:false});
  }finally{registry.pozaNutaDatabase=previous;await db.end({timeout:5});await removePostgresTestHarness(harness.containerName);}
});
