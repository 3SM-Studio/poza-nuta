import {test,expect,vi} from 'vitest';import {spawnSync} from 'node:child_process';import {drizzle} from 'drizzle-orm/postgres-js';import {writeFileSync} from 'node:fs';
import * as schema from '../../src/db/schema';import {startPostgresTestHarness,createPostgresTestClient,installPostgresCompatibilityFixture,applyPostgresMigrations,removePostgresTestHarness} from './postgresTestHarness';
import {normalizeSongSearchQuery} from '../../src/lib/song-search';
import {decodeSongSearchCursor} from '../../src/lib/song-search-cursor';
vi.mock('server-only',()=>({}));
test('paired P0 search on catalog-only data from a verified network-less PG17 restore',async()=>{
 const source=process.env.LOCAL_P0_CATALOG_CLONE;expect(source).toMatch(/^kunestu-restore-[a-f0-9]{10}$/);
 const inspected=JSON.parse(spawnSync('docker',['inspect',source!],{encoding:'utf8'}).stdout)[0];expect(inspected.HostConfig.NetworkMode).toBe('none');expect(Object.keys(inspected.HostConfig.PortBindings??{})).toHaveLength(0);
 const h=await startPostgresTestHarness('kunestu-p0-search'),sql=createPostgresTestClient(h,'postgres',2);const registry=globalThis as typeof globalThis&{pozaNutaDatabase?:ReturnType<typeof import('../../src/server/db')['getDb']>};let captured:{query:string;params:unknown[]}|undefined;
 try{
 await installPostgresCompatibilityFixture(sql);await applyPostgresMigrations(sql,36);
 const columns='source,source_song_id,title,artist,normalized_title,normalized_artist,search_text,genres,languages';
 // Only public catalog fields cross this local pipe. Never dump Auth, sessions,
 // participant records, recovery credentials or source configuration into app DB.
 const exported=spawnSync('docker',['exec',source!,'psql','-X','-q','-U','supabase_admin','-d','kunestu_restore','-c',`COPY (SELECT ${columns} FROM public.songs ORDER BY id) TO STDOUT WITH (FORMAT binary)`],{maxBuffer:64*1024*1024});expect(exported.status).toBe(0);
 const imported=spawnSync('docker',['exec','-i',h.containerName,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',`COPY public.songs (${columns}) FROM STDIN WITH (FORMAT binary)`],{input:exported.stdout,maxBuffer:1024*1024,timeout:180000});expect(imported.status).toBe(0);
 await sql`analyze songs`;await sql`analyze song_search_documents`;
 const [count]=await sql`select count(*)::int n from songs`;expect(count.n).toBeGreaterThan(90000);expect((await sql`select count(*)::int n from auth.users`)[0].n).toBe(0);
 registry.pozaNutaDatabase=drizzle({client:sql,schema,logger:{logQuery(query,params){if(query.includes('with exact_title'))captured={query,params};}}});
 const before=await import('../fixtures/song-search-unicode-p0-baseline'),after=await import('../../src/server/song-search-unicode');const metrics:unknown[]=[];const expected=new Map<string,Awaited<ReturnType<typeof before.searchUnicodeCatalogSongs>>>();
 for(const [label,service] of [['baseline',before],['candidate',after]] as const){for(const query of ['Beyonc\u00e9','love','love tonight','dancin queen','Bia\u0142a','\u041e\u043a\u0435\u0430\u043d','\u5468','artistt 30000','lo','ar','el la','i love you','love of my life','zzzzzz qqqqqq','danccing queeen','querywithnosuchwordsatallinthecatalogandnothingelse']){
  const samples:unknown[]=[];for(let run=0;run<2;run++){const start=performance.now();try{const page=await service.searchUnicodeCatalogSongs(query,null);if(label==='baseline')expected.set(query,page);else expect(page).toEqual(expected.get(query));samples.push({ms:performance.now()-start,ids:page.items.map(x=>x.id),nextCursor:page.nextCursor});}catch(error){if(label==='candidate')throw error;const cause=error instanceof Error&&error.cause?error.cause:error;if(!cause||typeof cause!=='object'||!('code'in cause)||cause.code!=='57014')throw error;samples.push({ms:performance.now()-start,code:cause&&typeof cause==='object'&&'code'in cause?cause.code:'UNKNOWN'});}}
  expect(captured).toBeDefined();const current=captured!;const parameters=current.params.map(value=>{if(value===null||typeof value==='string'||typeof value==='number'||typeof value==='boolean')return value;throw new Error('Unexpected explain parameter type');});const plan=await sql.begin(async tx=>{await tx`set local statement_timeout='15000'`;await tx`set local pg_trgm.strict_word_similarity_threshold='0.5'`;return tx.unsafe('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+current.query,parameters);});metrics.push({label,query,samples,plan});
  writeFileSync('.artifacts/p0-search-catalog.json',JSON.stringify({utc:new Date().toISOString(),rows:count.n,catalogOnly:true,usersCopied:0,metrics},null,2)+'\n');
 }}
 for(const [query,page] of expected){if(page.nextCursor){const cursor=decodeSongSearchCursor(page.nextCursor,normalizeSongSearchQuery(query),2);expect(cursor).not.toBeNull();expect(await after.searchUnicodeCatalogSongs(query,cursor)).toEqual(await before.searchUnicodeCatalogSongs(query,cursor));}}
 const concurrent=await Promise.all(Array.from({length:20},async(_,i)=>{const query=['love tonight','dancin queen','Океан','周'][i%4],start=performance.now();const page=await after.searchUnicodeCatalogSongs(query,null);expect(page).toEqual(expected.get(query));return {ms:performance.now()-start,query};}));
 writeFileSync('.artifacts/p0-search-concurrency.json',JSON.stringify({utc:new Date().toISOString(),pool:2,requests:20,concurrent},null,2)+'\n');
 }finally{delete registry.pozaNutaDatabase;await sql.end({timeout:5});await removePostgresTestHarness(h.containerName);}
},600000);
