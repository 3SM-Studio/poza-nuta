import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { decodeSongSearchCursor } from "../../src/lib/song-search-cursor.ts";
import { createSongSearchSingleFlight } from "../../src/server/song-search-single-flight.ts";
import { cpus, totalmem } from "node:os";
import { drizzle } from "drizzle-orm/postgres-js";
import { test, vi } from "vitest";
import * as schema from "../../src/db/schema.ts";
import { normalizeSongSearchText } from "../../src/lib/song-search.ts";
import { multilingualSongs } from "../fixtures/unicode-song-search.ts";
import { applyPostgresMigration, applyPostgresMigrations, createPostgresTestClient, installPostgresCompatibilityFixture, removePostgresTestHarness, startPostgresTestHarness } from "./postgresTestHarness.ts";

vi.mock("server-only", () => ({}));

type LoadSummary = {
  name: "baseline" | "optimized-sql" | "optimized-service";
  p50:number; p95:number; p99:number; timeouts:number; capacity:number;
  totalMs:number; sqlStatements:number; resources:string;
};


test("paired search reliability on an owned 92k synthetic PG17 catalog", async () => {
  const harness = await startPostgresTestHarness("kunestu-search-reliability");
  const connection = createPostgresTestClient(harness, "postgres", 2);
  let app = createPostgresTestClient(harness, "postgres", 2);
  const appClients=[app];
  const registry = globalThis as typeof globalThis & { pozaNutaDatabase?: ReturnType<typeof import("../../src/server/db.ts").getDb> };
  const prior = registry.pozaNutaDatabase;
  let sqlCount = 0;
  let captured: { query: string; params: unknown[] } | undefined;
  const result: Record<string, unknown> = { startedAt: new Date().toISOString(), corpus: "92,014 synthetic songs + multilingual fixtures; not provider data", node: process.version, cpu: cpus()[0].model, logicalCpus: cpus().length, ramGiB: totalmem()/2**30, poolMax: 2 };
  mkdirSync(".artifacts", { recursive: true });
  try {
    const cpuLimit=process.env.LOCAL_SEARCH_CPU_LIMIT;
    const signature=process.env.LOCAL_SEARCH_SIGNATURE ?? '256';
    assert.ok(!cpuLimit || cpuLimit==='2');
    assert.ok(['256','1024'].includes(signature));
    result.cpuLimit=cpuLimit ?? 'host'; result.signatureBytes=Number(signature);
    if(cpuLimit) await promisify(execFile)('docker',['update','--cpus',cpuLimit,harness.containerName]);
    await installPostgresCompatibilityFixture(connection);
    await applyPostgresMigrations(connection, 31);
    // Source inserts exercise the actual projection trigger. No restored/user data.
    await connection`insert into songs(source,source_song_id,title,artist,normalized_title,normalized_artist,search_text,genres,languages)
      select 'manual','reliability-'||n,
        (array['Love Tonight','Dancing Queen','Happy Day','Blue Moon','Hello World','Тиха ніч','Biała noc','光の歌','قلبي معك','Quiet River'])[1+n%10]||' '||n,
        'Artist '||(n%2500), 'song '||n,'artist '||(n%2500),'song '||n||' artist '||(n%2500)||' pop english',
        ARRAY[case when n%2=0 then 'Pop' else 'Rock' end], ARRAY[case when n%10=5 then 'uk' else 'en' end]
      from generate_series(1,92014) n`;
    for (const song of multilingualSongs) await connection`insert into songs(source,title,artist,normalized_title,normalized_artist,search_text)
      values('manual',${song.title},${song.artist},'', '', '')`;
    await connection`analyze songs`; await connection`analyze song_search_documents`;
    result.postgres = (await connection`select version()`)[0].version;
    registry.pozaNutaDatabase = drizzle({ client: app, schema, logger: { logQuery(query, params) {
      sqlCount++;
      if (query.includes("with exact_title")) captured = { query, params };
    } } });
    const { searchUnicodeCatalogSongs: baseline } = await import("../fixtures/song-search-unicode-baseline.ts");
    const { searchUnicodeCatalogSongs: optimized } = await import("../../src/server/song-search-unicode.ts");
    const queries = ["lo", "love", "love tonight", "queen dancing", "Dancing Queen", "dancin queen", "Biała", "Тиха", "周", "光", "unrelatedzzzxxyy", "Love Tonight 90000", "artist 30000", "artistt", "pop", "english", "ar", "song 30000", "danccing queeen", "artistt 30000", "songg 30000", "lovee tonite", "querywithnosuchwordsatallinthecatalogandnothingelse"];
    const pages = new Map<string, Awaited<ReturnType<typeof baseline>>>();
    const measurements: unknown[] = [], plans: unknown[] = [];
    result.measurements=measurements;result.plans=plans;
    const stats = async () => {
      const {stdout} = await promisify(execFile)("docker", ["stats", "--no-stream", "--format", "{{.CPUPerc}} {{.MemUsage}}", harness.containerName]);
      return stdout.trim();
    };
    result.idleResources = await stats();
    for (const [name, search] of [["baseline", baseline], ["optimized", optimized]] as const) {

      if(name==='optimized') {
        const started=performance.now();
        await applyPostgresMigration(connection,34);
        if(signature==='1024') {
          await connection`drop index public.song_search_documents_fuzzy_distance_idx`;
          await connection`create index song_search_documents_fuzzy_distance_idx on song_search_documents using gist((search_text || '') gist_trgm_ops(siglen=1024))`;
        }
        result.indexBuildMs=performance.now()-started;
        result.indexBytes=(await connection`select pg_relation_size('song_search_documents_fuzzy_distance_idx')::int as bytes`)[0].bytes;
      }
      for (const raw of queries) {
        const query = normalizeSongSearchText(raw), started = performance.now();
        try {
          const page = await search(query, null);
          const ms = performance.now()-started;
          if (name === "baseline") pages.set(query, page);
          else assert.deepEqual(page, pages.get(query), `complete first-page / cursor parity: ${query}`);
          measurements.push({ name, query, ms, count: page.items.length, responseBytes: Buffer.byteLength(JSON.stringify(page)), ids: page.items.map(s=>s.id) });
        } catch (error) {
          const cause = error instanceof Error && error.cause && typeof error.cause === "object" ? error.cause : error;
          assert.ok(cause && typeof cause === "object" && "code" in cause && cause.code === "57014", "unexpected errors / relevance failures must not be recorded as a passing benchmark");
          if (name === "optimized") throw error;
          measurements.push({name, query, ms: performance.now()-started, code:cause.code});
        }
        assert.ok(captured);
        const params = captured.params.map(value => {
          assert.ok(value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"); return value;
        });
        if (["lo", "love", "dancin queen", "Love Tonight 90000", "artist 30000", "artistt", "pop", "english", "ar", "song 30000", "danccing queeen", "artistt 30000", "songg 30000", "lovee tonite", "querywithnosuchwordsatallinthecatalogandnothingelse"].includes(raw)) {
          plans.push({ name, query, plan: await connection.begin(async tx => {
            await tx`set local statement_timeout='15000'`; await tx`set local pg_trgm.strict_word_similarity_threshold='0.5'`;
            return tx.unsafe("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + captured!.query, params);
          }) });
        }
      }
    }
    for (const raw of queries) {
      const query = normalizeSongSearchText(raw), cursor = pages.get(query)?.nextCursor;
      if (cursor) {
        const decoded = decodeSongSearchCursor(cursor,query,2); assert.ok(decoded);
        assert.deepEqual(await optimized(query, decoded), await baseline(query, decoded), `page two / cursor parity: ${query}`);
      }
    }
    const loads: Array<LoadSummary & {concurrency:number;n:number}> = [];
    result.loads=loads;
    const coalesce = createSongSearchSingleFlight<Awaited<ReturnType<typeof optimized>>>();
    const coordinated: typeof optimized = (query, cursor) => coalesce(app, JSON.stringify([query,cursor]), () => optimized(query,cursor));
    for (const [name, search] of [["baseline", baseline], ["optimized-sql", optimized], ["optimized-service", coordinated]] as const) {
      for (const concurrency of [1, 5, 20]) {
        const samples: number[] = []; let timeouts = 0, capacity = 0;
        const start = performance.now(), countBefore = sqlCount;
        const resourceSample = stats();
        await Promise.all(Array.from({ length: concurrency }, async (_, i) => {
          for (let run=0;run<4;run++) {
            const started = performance.now();
            try { await search(normalizeSongSearchText(["artist 30000", "artistt", "love tonight 90000", "song 30000"][(run+i)%4]), null); }
            catch (error) {
              const cause=error instanceof Error && error.cause ? error.cause : error;
              if(cause && typeof cause==='object' && 'code' in cause && cause.code==='57014') timeouts++;
              else if(cause && typeof cause==='object' && 'code' in cause && cause.code==='SERVICE_UNAVAILABLE' && 'status' in cause && cause.status===503) capacity++;
              else throw error;
            }
            samples.push(performance.now()-started);
          }
        }));
        const totalMs=performance.now()-start;
        const resources=await resourceSample;
        samples.sort((a,b)=>a-b);
        loads.push({name,concurrency,n:samples.length,p50:samples[Math.ceil(samples.length*.5)-1],p95:samples[Math.ceil(samples.length*.95)-1],p99:samples[Math.ceil(samples.length*.99)-1],timeouts,capacity,totalMs,sqlStatements:sqlCount-countBefore,resources});
      }
    }
    const rapid: unknown[] = [];
    for (const [name,search] of [["baseline",baseline],["optimized-service",coordinated]] as const) {
      const started=performance.now(), before=sqlCount;
      await Promise.all(["ar","art","arti","artis","artist","artist 3","artist 30","artist 300","artist 3000","artist 30000"].map(q=>search(q,null)));
      rapid.push({name,totalMs:performance.now()-started,sqlStatements:sqlCount-before,debounceApplied:false});
    }
    result.rapid=rapid;
    const {createCatalogDiscoveryCache}=await import("../../src/server/catalog-discovery-cache.ts");
    const cache=createCatalogDiscoveryCache<unknown>();
    const discovery=async()=>{
      const genres=await connection`select lower(trim(value)) value,count(*)::int count from songs cross join lateral unnest(genres) value group by lower(trim(value)) order by count desc,value limit 30`;
      const languages=await connection`select lower(trim(value)) value,count(*)::int count from songs cross join lateral unnest(languages) value group by lower(trim(value)) order by count desc,value limit 30`;
      return {genres,languages};
    };
    const categories=[];
    for(const cached of [false,true]){
      let calls=0;const load=async()=>{calls++;return discovery();};
      const started=performance.now();
      const responses=await Promise.all(Array.from({length:20},()=>cached?cache.get(connection,load):load()));
      for(const response of responses)assert.deepEqual(response,responses[0]);
      categories.push({cached,requests:20,aggregateSql:2*calls,totalMs:performance.now()-started});
    }
    result.categories=categories;
    result.connections=await connection`select count(*)::int as clients from pg_stat_activity where backend_type='client backend' and datname=current_database()`;
    const distinctLoads: Array<LoadSummary & {poolMax:number;requests:number}>=[];
    result.distinctLoads=distinctLoads;
    for(const poolMax of [2,20]) {
      if(poolMax===20) {
        app=createPostgresTestClient(harness,"postgres",20); appClients.push(app);
        registry.pozaNutaDatabase=drizzle({client:app,schema,logger:{logQuery(){sqlCount++;}}});
      }
      for(const [name,search] of [["baseline",baseline],["optimized-service",coordinated]] as const) {
        const samples:number[]=[]; let timeouts=0, capacity=0;const before=sqlCount, started=performance.now();
        const resources=stats();
        await Promise.all(Array.from({length:20},async(_,i)=>{
          const start=performance.now();
          try {await search(`artist ${30000+i}`,null);}
          catch(error){
            const cause=error instanceof Error&&error.cause?error.cause:error;
            if(cause&&typeof cause==='object'&&'code' in cause&&cause.code==='57014')timeouts++;
            else if(cause&&typeof cause==='object'&&'code' in cause&&cause.code==='SERVICE_UNAVAILABLE'&&'status' in cause&&cause.status===503)capacity++;
            else throw error;
          }
          samples.push(performance.now()-start);
        }));
        samples.sort((a,b)=>a-b);
        distinctLoads.push({name,poolMax,requests:20,p50:samples[9],p95:samples[18],p99:samples[19],timeouts,capacity,totalMs:performance.now()-started,sqlStatements:sqlCount-before,resources:await resources});
      }
    }
    result.distinctLoads=distinctLoads;
    result.loads=loads;
    for(const row of [...loads,...distinctLoads]) {
      if(row.name==='optimized-service') {
        assert.equal(row.timeouts,0,'final service must not turn overload into SQL cancellations');
        assert.equal(row.capacity,0,'representative final-service workload must complete, not return capacity errors');
      }
    }
    result.measurements = measurements; result.plans = plans;
    console.info("SEARCH_RELIABILITY " + JSON.stringify(measurements));
  } finally {
    result.finishedAt = new Date().toISOString();
    writeFileSync(".artifacts/search-reliability-measurements.json", JSON.stringify(result, null, 2));
    registry.pozaNutaDatabase = prior;
    await Promise.all(appClients.map(client=>client.end({timeout:5}))); await connection.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }
});
