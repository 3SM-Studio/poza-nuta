import assert from 'node:assert/strict';
import {test} from 'vitest';
import {drizzle} from 'drizzle-orm/postgres-js';
import {migrate} from 'drizzle-orm/postgres-js/migrator';
import {readMigrationFiles} from 'drizzle-orm/migrator';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {startPostgresTestHarness,createPostgresTestClient,installPostgresCompatibilityFixture,applyPostgresMigrations,removePostgresTestHarness} from './postgresTestHarness';

test('official Drizzle batches separate queue DDL from fuzzy index under concurrent synthetic traffic',async()=>{
 const harness=await startPostgresTestHarness('kunestu-release-window');
 let source=createPostgresTestClient(harness,'postgres',1);
 const folder=await mkdtemp(join(tmpdir(),'kunestu-release-migrations-'));
 const evidence:Record<string,unknown>={startedUtc:new Date().toISOString(),synthetic:true,cpuQuota:2,productionWrites:0};
 try{
  execFileSync('docker',['update','--cpus','2',harness.containerName],{stdio:'pipe'});
  await installPostgresCompatibilityFixture(source);await applyPostgresMigrations(source,31);
  const migrations=readMigrationFiles({migrationsFolder:'drizzle'});
  await source`create schema drizzle`;await source`create table drizzle.__drizzle_migrations(id serial primary key,hash text not null,created_at bigint)`;
  for(const m of migrations.slice(0,32))await source`insert into drizzle.__drizzle_migrations(hash,created_at) values(${m.hash},${m.folderMillis})`;
  await source`insert into songs(source,source_song_id,title,artist,normalized_title,normalized_artist,search_text) select 'manual','window-'||n,'Synthetic song '||n,'Artist '||(n%2500),'','','' from generate_series(1,92014) n`;
  const [w]=await source`insert into workspaces(name,handle,public_id) values('Synthetic window','synthetic-window',${randomBytes(10).toString('hex')}) returning id`;
  const [e]=await source`insert into events(workspace_id,name,starts_at,ends_at,status) values(${w.id},'Synthetic window',now(),now()+interval '4 hour','active') returning id`;
  await source`insert into event_sessions(event_id,public_token) values(${e.id},${randomBytes(16).toString('base64url')})`;
  await source`insert into song_requests(event_id,song_id,singer_name,display_name,status,position,requested_by) select ${e.id},id,'Synthetic','Synthetic','approved',row_number() over(order by id),'operator' from songs order by id limit 20`;
  await source.end({timeout:5});
  const admin=createPostgresTestClient(harness,'template1',1);
  try{await admin`create database gate_combined template postgres`;await admin`create database gate_split template postgres`;}finally{await admin.end({timeout:5});}
  const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));
  await mkdir(join(folder,'meta'));await writeFile(join(folder,'meta/_journal.json'),JSON.stringify({...journal,entries:journal.entries.slice(0,34)}));
  for(const entry of journal.entries.slice(0,34))await copyFile(`drizzle/${entry.tag}.sql`,join(folder,entry.tag+'.sql'));
  const failureFolder=join(folder,'fault');await mkdir(join(failureFolder,'meta'),{recursive:true});
  await writeFile(join(failureFolder,'meta/_journal.json'),JSON.stringify(journal));
  for(const entry of journal.entries){
   const sql=await readFile(`drizzle/${entry.tag}.sql`,'utf8');
   await writeFile(join(failureFolder,entry.tag+'.sql'),sql+(entry.idx===34?'\n--> statement-breakpoint\nSELECT 1/0;':''));
  }
  const results=[];
  for(const mode of ['combined','split'] as const){
   const db=createPostgresTestClient(harness,'gate_'+mode,1),traffic=createPostgresTestClient(harness,'gate_'+mode,1),observe=createPostgresTestClient(harness,'gate_'+mode,1);
   const samples:Array<{phase:string;ms:number}>=[],phases:Array<{name:string;wallMs:number;queueExclusiveSamples:number;catalogShareSamples:number}>=[];
   let stopped=false,phase='before',observing=false;
   try{
    await db`set lock_timeout='2s'`;await db`set statement_timeout='30s'`;
    const writer=(async()=>{while(!stopped){const p=phase,start=performance.now();await traffic`update song_requests set position=position where id=(select min(id) from song_requests)`;samples.push({phase:p,ms:performance.now()-start});await new Promise(r=>setTimeout(r,10));}})();
    try{
     await new Promise(r=>setTimeout(r,100));
     for(const [name,migrationsFolder] of mode==='combined'?[['all','drizzle']]:[['queue-schema',folder],['index-and-policy','drizzle']]){
      if(mode==='split'&&name==='index-and-policy'){
       phase='expected-index-rollback';
       await assert.rejects(migrate(drizzle({client:db}),{migrationsFolder:failureFolder}),error=>{
        const cause=error instanceof Error&&error.cause?error.cause:error;
        return typeof cause==='object'&&cause!==null&&'code' in cause&&cause.code==='22012';
       });
       assert.equal((await db`select count(*)::int n from drizzle.__drizzle_migrations`)[0].n,34);
       assert.equal((await db`select to_regclass('public.song_search_documents_fuzzy_distance_idx') name`)[0].name,null);
       evidence.interruptedSecondPhase='expected fault rolled back index and history; 0032/0033 remained; retry of original files succeeded';
      }
      phase=name;let queueExclusiveSamples=0,catalogShareSamples=0;observing=true;
      const monitor=(async()=>{while(observing){
       const locks=await observe`select c.relname,l.mode from pg_locks l join pg_class c on c.oid=l.relation where l.granted and c.relnamespace='public'::regnamespace and l.pid<>pg_backend_pid() and c.relname in ('song_requests','song_search_documents')`;
       queueExclusiveSamples+=locks.filter(x=>x.relname==='song_requests'&&x.mode==='AccessExclusiveLock').length;
       catalogShareSamples+=locks.filter(x=>x.relname==='song_search_documents'&&x.mode==='ShareLock').length;
       await new Promise(r=>setTimeout(r,10));
      }})();
      const start=performance.now();try{await migrate(drizzle({client:db}),{migrationsFolder:resolve(migrationsFolder)});}finally{observing=false;await monitor;}
      phases.push({name,wallMs:performance.now()-start,queueExclusiveSamples,catalogShareSamples});
      phase='between';await new Promise(r=>setTimeout(r,100));
     }
    }finally{stopped=true;await writer;}
    const applied=await db`select hash from drizzle.__drizzle_migrations order by created_at,id`;
    assert.deepEqual(applied.map(x=>x.hash),migrations.map(x=>x.hash));
    assert.equal((await db`select count(*)::int n from songs`)[0].n,92014);assert.equal((await db`select count(*)::int n from song_requests`)[0].n,20);
    const [index]=await db`select indisvalid,indisready from pg_index where indexrelid='song_search_documents_fuzzy_distance_idx'::regclass`;assert.ok(index.indisvalid&&index.indisready);
    if(mode==='split'){
     const indexPhase=phases.find(p=>p.name==='index-and-policy')!;
     assert.equal(indexPhase.queueExclusiveSamples,0,'the index phase must not retain the queue table exclusive lock');
     assert.ok(indexPhase.catalogShareSamples>0,'observe the actual index lock, not an empty measurement');
    }
    // Repeating the exact official runner is safe and leaves history unchanged.
    await migrate(drizzle({client:db}),{migrationsFolder:'drizzle'});assert.equal((await db`select count(*)::int n from drizzle.__drizzle_migrations`)[0].n,migrations.length);
    results.push({mode,phases,trafficWrites:samples.length,maxTrafficMs:Math.max(...samples.map(s=>s.ms)),samples});
   }finally{await db.end({timeout:5});await traffic.end({timeout:5});await observe.end({timeout:5});}
  }
  evidence.results=results;evidence.status='PASS';
 }finally{
  evidence.finishedUtc=new Date().toISOString();await mkdir('.artifacts',{recursive:true});await writeFile('.artifacts/release-gate-migration-window.json',JSON.stringify(evidence,null,2)+'\n');
  await source.end({timeout:5});await removePostgresTestHarness(harness.containerName);
  // Only the exact directory returned by mkdtemp under the OS temporary root.
  if(!resolve(folder).startsWith(resolve(tmpdir())+'\\kunestu-release-migrations-'))throw new Error('Unexpected temporary folder');
  await rm(folder,{recursive:true,force:true});
 }
});
