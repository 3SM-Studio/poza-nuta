import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { test, vi } from "vitest";
import { applyPostgresMigrations, createPostgresTestClient, installPostgresCompatibilityFixture, removePostgresTestHarness, startPostgresTestHarness } from "./postgresTestHarness.ts";
vi.mock("server-only", () => ({}));

test("Unicode search pool recovers after PostgreSQL statement cancellation", async () => {
  const harness=await startPostgresTestHarness("kunestu-unicode-timeout");
  const admin=createPostgresTestClient(harness,"postgres");
  const priorUrl=process.env.DATABASE_URL,priorEngine=process.env.SONG_SEARCH_ENGINE;
  const registry=globalThis as typeof globalThis & { pozaNutaDatabase?: ReturnType<typeof import("../../src/server/db.ts").getDb> };
  try {
    await installPostgresCompatibilityFixture(admin);await applyPostgresMigrations(admin,31);
    // A restricted importer may write songs, but cannot call private helpers
    // or write the projection directly. The fixed-path trigger owns that work.
    await admin`create role unicode_import_fixture nologin`;
    await admin`grant insert on songs to unicode_import_fixture`;
    await admin`grant usage on sequence songs_id_seq to unicode_import_fixture`;
    await admin`create policy unicode_import_fixture_insert on songs for insert to unicode_import_fixture with check (artist='Importer fixture')`;
    await admin.begin(async tx=>{
      await tx`set local role unicode_import_fixture`;
      await tx`insert into songs(source,title,artist,normalized_title,normalized_artist,search_text) values('manual','光','Importer fixture','','','')`;
    });
    const [projection]=await admin`select d.normalized_title from song_search_documents d join songs s on s.id=d.song_id where s.artist='Importer fixture'`;
    assert.equal(projection.normalized_title,'光');
    const [permission]=await admin`select has_function_privilege('unicode_import_fixture','kunestu_search_normalize_v2(text)','EXECUTE') as rpc`;
    assert.equal(permission.rpc,false);
    await admin`insert into songs(source,title,artist,normalized_title,normalized_artist,search_text) values('manual','Группа крови','Кино','','','')`;
    process.env.DATABASE_URL=`postgresql://postgres:${encodeURIComponent(harness.password)}@127.0.0.1:${harness.port}/postgres`;
    process.env.SONG_SEARCH_ENGINE="unicode-v2";
    const {getDb}=await import("../../src/server/db.ts");
    await assert.rejects(getDb().transaction(async tx=>{
      await tx.execute(sql`select set_config('statement_timeout','20',true)`);
      await tx.execute(sql`select pg_sleep(0.1)`);
    }), error=>{
      const cause=error instanceof Error && "cause" in error ? error.cause : error;
      return typeof cause==="object" && cause!==null && "code" in cause && cause.code==="57014";
    });
    const {searchCatalogSongs}=await import("../../src/server/song-search.ts");
    for(let retry=0;retry<3;retry++)assert.equal((await searchCatalogSongs("кино")).items[0]?.title,"Группа крови");
  } finally {
    if(registry.pozaNutaDatabase)await registry.pozaNutaDatabase.$client.end({timeout:5});delete registry.pozaNutaDatabase;
    if(priorUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=priorUrl;
    if(priorEngine===undefined)delete process.env.SONG_SEARCH_ENGINE;else process.env.SONG_SEARCH_ENGINE=priorEngine;
    await admin.end({timeout:5});await removePostgresTestHarness(harness.containerName);
  }
});
