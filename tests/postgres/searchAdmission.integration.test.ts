import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { test, vi } from "vitest";
import * as schema from "../../src/db/schema.ts";
import { createPostgresTestClient, removePostgresTestHarness, startPostgresTestHarness } from "./postgresTestHarness.ts";
vi.mock('server-only',()=>({}));

test('database-wide search admission bounds independent clients, releases on rollback and expires safely',async()=>{
  const harness=await startPostgresTestHarness('kunestu-search-admission');
  const app=createPostgresTestClient(harness,'postgres',8), admin=createPostgresTestClient(harness,'postgres',4);
  const registry=globalThis as typeof globalThis & {pozaNutaDatabase?:ReturnType<typeof import('../../src/server/db.ts').getDb>};
  const previous=registry.pozaNutaDatabase;
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  try{
    registry.pozaNutaDatabase=drizzle({client:app,schema});
    const {withSongSearchAdmission,SONG_SEARCH_LOCK_NAMESPACE:namespace}=await import('../../src/server/song-search-admission.ts');
    let active=0,peak=0;
    const results=await Promise.all(Array.from({length:20},(_,i)=>withSongSearchAdmission(async tx=>{
      active++;peak=Math.max(peak,active);
      try{await tx.execute(sql`select pg_sleep(0.03)`);return i;}finally{active--;}
    })));
    assert.equal(peak,2);assert.equal(results.length,20);
    await assert.rejects(withSongSearchAdmission(async()=>{throw new Error('intentional rollback');}),/intentional rollback/);
    assert.equal(await withSongSearchAdmission(async()=>17),17);
    // Locks held by a separate connection pool, not a JavaScript-local semaphore.
    const releases:Array<()=>void>=[], ready:Promise<void>[]=[], held:Promise<unknown>[]=[];
    for(const slot of [1,2]){
      let markReady!:()=>void;ready.push(new Promise<void>(resolve=>{markReady=resolve;}));
      const gate=new Promise<void>(resolve=>{releases.push(resolve);});
      held.push(admin.begin(async tx=>{await tx`select pg_advisory_xact_lock(${namespace},${slot})`;markReady();await gate;}));
    }
    try{
      await Promise.all(ready);let ran=false;
      const started=performance.now();
      await assert.rejects(withSongSearchAdmission(async()=>{ran=true;return 1;}),error=>
        typeof error==='object'&&error!==null&&'status' in error&&error.status===503&&'code' in error&&error.code==='SERVICE_UNAVAILABLE');
      assert.equal(ran,false);assert.ok(performance.now()-started>=6000);
      const [{waiting}]=await admin<{waiting:number}[]>`select count(*)::int waiting from pg_stat_activity
        where datname=current_database() and wait_event_type='Lock'`;
      assert.equal(waiting,0,'nonblocking permit attempts must not leave lock-waiting backends');
    }finally{releases.forEach(release=>release());await Promise.all(held);}
    assert.equal(await withSongSearchAdmission(async()=>23),23);
    const [{locks}]=await admin<{locks:number}[]>`select count(*)::int locks from pg_locks where locktype='advisory' and classid=${namespace}::oid`;
    assert.equal(locks,0);
  }finally{log.mockRestore();registry.pozaNutaDatabase=previous;await app.end({timeout:5});await admin.end({timeout:5});await removePostgresTestHarness(harness.containerName);}
});
