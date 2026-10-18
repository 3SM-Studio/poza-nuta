import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema';
import { createQueueOperation } from '../../src/lib/queue-collaboration';
import type { QueueOperation } from '../../src/lib/queue-operation';
import { applyPostgresMigrations,createPostgresTestClient,installPostgresCompatibilityFixture,removePostgresTestHarness,startPostgresTestHarness,type PostgresTestHarness } from './postgresTestHarness';
vi.mock('server-only',()=>({}));

let harness:PostgresTestHarness,connection:ReturnType<typeof createPostgresTestClient>;
let service:typeof import('../../src/server/operator-api/queue-sync');
let legacy:typeof import('../../src/server/operator-api/event-queue');
let fair:typeof import('../../src/server/operator-api/fair-queue');
let actor:number,actor2:number,viewer:string,workspace:number,song:number;
const auth=randomUUID(),auth2=randomUUID(),organizationId='collaborationtest001';
const device=randomUUID(),device2=randomUUID();
let scope:{authUserId:string;organizationId:string;eventId:string},eventId:number,ids:number[];
const registry=globalThis as typeof globalThis & {pozaNutaDatabase?:ReturnType<typeof import('../../src/server/db')['getDb']>};

beforeAll(async()=>{
  harness=await startPostgresTestHarness('kunestu-collaboration');connection=createPostgresTestClient(harness,'postgres',8);
  await installPostgresCompatibilityFixture(connection);await applyPostgresMigrations(connection,36);
  registry.pozaNutaDatabase=drizzle({client:connection,schema});
  service=await import('../../src/server/operator-api/queue-sync');legacy=await import('../../src/server/operator-api/event-queue');fair=await import('../../src/server/operator-api/fair-queue');
  [workspace]= (await connection`insert into workspaces(name,handle,public_id) values('Collaboration','collaboration',${organizationId}) returning id::int`).map(x=>x.id);
  viewer=randomUUID();
  for(const [id,role] of [[auth,'owner'],[auth2,'operator'],[viewer,'viewer']] as const){
    await connection`insert into auth.users(id) values(${id})`;
    const [op]=await connection`insert into operator_users(name,display_name,profile_completed_at,auth_user_id,password_hash) values(${id},'Synthetic operator',now(),${id},'test-only') returning id::int`;
    await connection`insert into workspace_members(workspace_id,operator_user_id,role) values(${workspace},${op.id},${role})`;
    if(id===auth)actor=op.id;if(id===auth2)actor2=op.id;
  }
  [song]=(await connection`insert into songs(source,title,artist,normalized_title,normalized_artist,search_text) values('manual','Synthetic','Artist','synthetic','artist','synthetic artist') returning id::int`).map(x=>x.id);
  await connection.unsafe(`create table realtime.test_queue_messages(payload jsonb,event_name text,topic text);
    create or replace function realtime.send(payload jsonb,event_name text,topic_name text,private_channel boolean) returns void language plpgsql as $$ begin insert into realtime.test_queue_messages values(payload,event_name,topic_name); end $$;`);
});
beforeEach(async()=>{
  const [event]=await connection`insert into events(workspace_id,name,starts_at,ends_at,status,song_requests_enabled,public_queue_enabled) values(${workspace},'Isolated collaboration',now()-interval '1 hour',now()+interval '4 hours','active',true,true) returning id::int,public_id`;
  eventId=event.id;scope={authUserId:auth,organizationId,eventId:event.public_id};
  await connection`insert into event_sessions(event_id,public_token) values(${eventId},${randomBytes(16).toString('base64url')})`;
  ids=[];for(let i=1;i<=6;i++){const [r]=await connection`insert into song_requests(event_id,song_id,singer_name,display_name,status,position,requested_by) values(${eventId},${song},${'Singer '+i},${'Singer '+i},'approved',${i},'operator') returning id::int`;ids.push(r.id);}
});
afterAll(async()=>{delete registry.pozaNutaDatabase;await connection?.end({timeout:5});if(harness)await removePostgresTestHarness(harness.containerName);});

async function snapshot(authUserId:string=auth,deviceId:string=device,operationIds:string[]=[]){return service.getQueueSyncSnapshot({...scope,authUserId},deviceId,operationIds);}
async function operation(index:number,position:number,who=1):Promise<QueueOperation>{
  const s=await snapshot(who===1?auth:auth2,who===1?device:device2);
  const items=s.items.map(r=>({...r,createdAt:r.createdAt.toISOString(),updatedAt:r.updatedAt.toISOString(),startedAt:r.startedAt?.toISOString()??null,completedAt:r.completedAt?.toISOString()??null}));
  return createQueueOperation(items,who===1?device:device2,who===1?actor:actor2,s.sortRevision,ids[index],{kind:'placement',lane:'approved',position})!;
}
async function action(index:number,kind:'start'|'done'|'approve',who=1){const op=await operation(index,1,who),s=await snapshot();return {operationId:op.operationId,deviceId:op.deviceId,actorId:op.actorId,requestId:op.requestId,expectedStatus:op.expectedStatus,expectedIntentVersion:op.expectedIntentVersion,sortRevision:op.sortRevision,kind:'action' as const,action:kind,expectedNow:s.items.find(x=>x.status==='now')?{id:s.items.find(x=>x.status==='now')!.id,intentVersion:s.items.find(x=>x.status==='now')!.intentVersion}:null};}
const apply=(op:QueueOperation,authUserId:string=auth)=>service.applyQueueOperation({...scope,authUserId},op);
const code=(value:string)=>expect.objectContaining({code:value});

describe('PG17 transactional collaboration',()=>{
  it('rejects forged, cross-transaction and cross-scope authorization proofs before writes',async()=>{
    const db=registry.pozaNutaDatabase!;
    const input={...scope,requestId:ids[0],action:'start' as const};
    const before=await snapshot();
    await db.transaction(async transaction=>{
      const context=await legacy.requireEventQueueManagerContext(transaction,auth,organizationId,scope.eventId);
      await expect(legacy.applyDashboardOrganizationEventQueueActionForAuthUser(input,transaction,{...context})).rejects.toMatchObject({status:403});
      await expect(legacy.applyDashboardOrganizationEventQueueActionForAuthUser({...input,authUserId:auth2},transaction,context)).rejects.toMatchObject({status:403});
      await expect(db.transaction(other=>legacy.applyDashboardOrganizationEventQueueActionForAuthUser(input,other,context))).rejects.toMatchObject({status:403});
    });
    expect((await snapshot()).items).toEqual(before.items);
    expect((await connection`select count(*)::int n from queue_operation_receipts where event_id=${eventId}`)[0].n).toBe(0);
  });
  it('snapshot authorization rejects inactive profiles, memberships and other organizations',async()=>{
    await expect(service.getQueueSyncSnapshot({...scope,organizationId:'notthisworkspace001'},device,[])).rejects.toMatchObject({status:404});
    await connection`update workspace_members set active=false where workspace_id=${workspace} and operator_user_id=${actor2}`;
    try{await expect(snapshot(auth2,device2)).rejects.toMatchObject({status:404});}finally{await connection`update workspace_members set active=true where workspace_id=${workspace} and operator_user_id=${actor2}`;}
    await connection`update operator_users set active=false where id=${actor2}`;
    try{await expect(snapshot(auth2,device2)).rejects.toMatchObject({status:404});}finally{await connection`update operator_users set active=true where id=${actor2}`;}
    expect((await snapshot(viewer)).canManage).toBe(false);
  });
  it('new event v2 and emergency legacy fallback invalidate previews without changing a live order',async()=>{
    vi.stubEnv('KUNESTU_FAIR_QUEUE_ENGINE',undefined);
    try{
      const before=await snapshot(),v2=await fair.previewFairEventQueue(scope);expect(v2.engine).toBe('rotation-v2');
      vi.stubEnv('KUNESTU_FAIR_QUEUE_ENGINE','legacy');const old=await fair.previewFairEventQueue(scope);expect(old.engine).toBe('legacy');
      await expect(fair.applyFairEventQueue({...scope,revision:v2.revision})).rejects.toMatchObject({code:'FAIR_QUEUE_PREVIEW_STALE'});
      expect((await snapshot()).items).toEqual(before.items);
      vi.stubEnv('KUNESTU_FAIR_QUEUE_ENGINE',undefined);expect((await fair.previewFairEventQueue(scope)).engine).toBe('rotation-v2');
      expect((await snapshot()).items).toEqual(before.items);
      await connection`update events set fair_queue_engine='legacy' where id=${eventId}`;
      vi.stubEnv('KUNESTU_FAIR_QUEUE_ENGINE','rotation-v2');expect((await fair.previewFairEventQueue(scope)).engine).toBe('legacy');
      const [pending]=await connection`insert into song_requests(event_id,song_id,singer_name,display_name,status,position,requested_by) values(${eventId},${song},'Fallback','Fallback','pending',0,'operator') returning id::int`;ids.push(pending.id);
      await apply(await action(ids.length-1,'approve'));
      const final=await snapshot();expect(final.items).toHaveLength(before.items.length+1);
      expect(final.items.filter(x=>x.status==='approved'&&x.id!==pending.id).sort((a,b)=>a.position-b.position).map(x=>x.id)).toEqual(before.items.filter(x=>x.status==='approved').sort((a,b)=>a.position-b.position).map(x=>x.id));
      const [audit]=await connection`select payload->>'engine' engine from operator_audit_log where event_id=${eventId} and action='event_queue_fair_admission' and entity_id=${String(pending.id)} order by id desc limit 1`;expect(audit.engine).toBe('legacy');
    }finally{vi.unstubAllEnvs();}
  });
  it('versions no-op Fair Sort and lifecycle snapshots, and permits owned fixture cleanup',async()=>{
    const a=await fair.previewFairEventQueue(scope);await fair.applyFairEventQueue({...scope,revision:a.revision});
    const before=await snapshot(),b=await fair.previewFairEventQueue(scope);await fair.applyFairEventQueue({...scope,revision:b.revision});
    const sorted=await snapshot();expect(BigInt(sorted.revision)).toBe(BigInt(before.revision)+1n);
    await connection`update events set auto_close_at=now()-interval '1 minute' where id=${eventId}`;
    const expired=await snapshot();expect(expired.lifecycle).toBe('closed');expect(BigInt(expired.revision)).toBe(BigInt(sorted.revision)+1n);
    await connection`update events set status='closed',closed_at=now(),close_reason='manual' where id=${eventId}`;
    const closed=await snapshot();expect(closed.lifecycle).toBe('closed');expect(BigInt(closed.revision)).toBe(BigInt(expired.revision)+1n);
    await connection`delete from events where id=${eventId}`;
    expect((await connection`select * from queue_streams where event_id=${eventId}`).length).toBe(0);
  });
  it('refreshes current names while preserving request snapshots and semantic movement versions',async()=>{
    const [identity]=await connection`insert into participant_identities default values returning id`;
    const [member]=await connection`insert into event_participants(event_session_id,participant_id,display_name,normalized_display_name)
      select id,${identity.id},'Dimon','dimon' from event_sessions where event_id=${eventId} returning id`;
    await connection`update song_requests set event_participant_id=${member.id} where id=${ids[0]}`;
    const intent=await operation(0,5),before=await snapshot();
    await connection`update event_participants set display_name='Dima',normalized_display_name='dima' where id=${member.id}`;
    const after=await snapshot(),r=after.items.find(x=>x.id===ids[0])!;
    expect(r.displayName).toBe('Dima');expect(r.requestDisplayName).toBe('Singer 1');expect(r.nicknameChanges?.[0]).toMatchObject({before:'Dimon',after:'Dima'});
    expect(r.completedCount).toBe(0);expect(r.intentVersion).toBe(before.items.find(x=>x.id===ids[0])!.intentVersion);expect(BigInt(after.revision)).toBeGreaterThan(BigInt(before.revision));
    await apply(intent);expect((await snapshot()).items.find(x=>x.id===ids[0])?.displayName).toBe('Dima');
    const [stored]=await connection`select display_name from song_requests where id=${ids[0]}`;expect(stored.display_name).toBe('Singer 1');
  });
  it('uses immutable new confirmations after restore and does not count an explicitly cancelled now',async()=>{
    const [identity]=await connection`insert into participant_identities default values returning id`;
    const [member]=await connection`insert into event_participants(event_session_id,participant_id,display_name,normalized_display_name)
      select id,${identity.id},'Singer','singer' from event_sessions where event_id=${eventId} returning id`;
    await connection`update song_requests set event_participant_id=${member.id} where id=${ids[0]}`;
    await apply(await action(0,'start'));let source=await action(0,'done');
    await apply({...source,action:'restore'});expect((await snapshot()).items.find(x=>x.id===ids[0])?.completedCount).toBe(0);
    await apply(await action(0,'start'));await apply(await action(0,'done'));
    expect((await snapshot()).items.find(x=>x.id===ids[0])?.completedCount).toBe(1);
    source=await action(0,'done');await apply({...source,action:'restore'});
    expect((await snapshot()).items.find(x=>x.id===ids[0])?.completedCount).toBe(1);
    const [audit]=await connection`select count(*)::int n from operator_audit_log where event_id=${eventId} and action='event_queue_performance_cancelled'`;expect(audit.n).toBe(1);
  });
  it('rolls back a rename audit, revision and broadcasts together and denies browser function execution',async()=>{
    const [identity]=await connection`insert into participant_identities default values returning id`;
    const [member]=await connection`insert into event_participants(event_session_id,participant_id,display_name,normalized_display_name)
      select id,${identity.id},'Before','before' from event_sessions where event_id=${eventId} returning id`;
    const before=await snapshot(),messages=await connection`select count(*)::int n from realtime.test_queue_messages`;
    await expect(connection.begin(async tx=>{await tx`update event_participants set display_name='After',normalized_display_name='after' where id=${member.id}`;throw new Error('synthetic rollback');})).rejects.toThrow('synthetic rollback');
    expect((await snapshot()).revision).toBe(before.revision);
    expect((await connection`select display_name from event_participants where id=${member.id}`)[0].display_name).toBe('Before');
    expect((await connection`select count(*)::int n from realtime.test_queue_messages`)[0].n).toBe(messages[0].n);
    expect((await connection`select count(*)::int n from operator_audit_log where event_id=${eventId} and action='participant_nickname_changed'`)[0].n).toBe(0);
    const [grants]=await connection`select has_function_privilege('anon','private.participant_presentation_changed()','EXECUTE') a,has_function_privilege('authenticated','private.participant_presentation_changed()','EXECUTE') b`;
    expect(grants).toEqual({a:false,b:false});
    await connection`update event_participants set display_name='After',normalized_display_name='after' where id=${member.id}`;
    const participants=await import('../../src/server/operator-api/event-participants');
    const summary=(await participants.listEventParticipants(scope)).items.find(m=>m.id===Number(member.id))!;
    expect(summary.completedCount).toBe(0);expect(summary.nicknameChanges).toHaveLength(1);expect(summary.nicknameChanges[0]).toMatchObject({before:'Before',after:'After'});
    const detail=await participants.getEventParticipant({...scope,participantId:Number(member.id)});expect(detail.participant.nicknameChanges).toEqual(summary.nicknameChanges);

  });
  it('coalesces a presentation change and queue movement while retaining every real rename audit',async()=>{
    const [identity]=await connection`insert into participant_identities default values returning id`;
    const [member]=await connection`insert into event_participants(event_session_id,participant_id,display_name,normalized_display_name)
      select id,${identity.id},'Before','before' from event_sessions where event_id=${eventId} returning id`;
    const before=await snapshot();
    await connection.begin(async tx=>{
      await tx`update song_requests set position=position+1 where event_id=${eventId}`;
      await tx`update event_participants set display_name='Middle',normalized_display_name='middle' where id=${member.id}`;
      await tx`update event_participants set display_name='After',normalized_display_name='after' where id=${member.id}`;
    });
    const after=await snapshot();expect(BigInt(after.revision)).toBe(BigInt(before.revision)+1n);
    const messages=await connection`select payload from realtime.test_queue_messages where topic=${'dashboard:event:'+eventId+':queue'} and payload->>'revision'=${after.revision}`;
    expect(messages).toHaveLength(1);expect(Object.keys(messages[0].payload).sort()).toEqual(['changedAt','eventId','operation','revision','type']);
    const names=await connection`select payload from operator_audit_log where event_id=${eventId} and action='participant_nickname_changed' order by id`;
    expect(names.map(r=>r.payload)).toEqual([{before:'Before',after:'Middle'},{before:'Middle',after:'After'}]);
  });
  it('preserves observed legacy completions through restore without inventing a rename',async()=>{
    const [identity]=await connection`insert into participant_identities default values returning id`;
    const [member]=await connection`insert into event_participants(event_session_id,participant_id,display_name,normalized_display_name)
      select id,${identity.id},'Legacy','legacy' from event_sessions where event_id=${eventId} returning id`;
    await connection`update song_requests set event_participant_id=${member.id},status='done',completed_at=now()-interval '1 hour',position=0 where id=${ids[0]}`;
    const source=await action(0,'done');await apply({...source,action:'restore'});
    const item=(await snapshot()).items.find(x=>x.id===ids[0])!;expect(item.completedCount).toBe(1);expect(item.nicknameChanges).toEqual([]);expect(item.requestDisplayName).toBe('Singer 1');
    const [audit]=await connection`select payload from operator_audit_log where event_id=${eventId} and action='event_queue_performance_completed'`;expect(audit.payload).toMatchObject({confirmation:'legacy_done_observed_before_restore',timeKnown:true});expect(Object.keys(audit.payload).sort()).toEqual(['confirmation','requestVersion','timeKnown']);expect(Number.isSafeInteger(audit.payload.requestVersion)).toBe(true);
  });
  it('reconciles original explicit done/restore audits and deduplicates later confirmed performances',async()=>{
    const [identity]=await connection`insert into participant_identities default values returning id`;
    const [member]=await connection`insert into event_participants(event_session_id,participant_id,display_name,normalized_display_name)
      select id,${identity.id},'Historical','historical' from event_sessions where event_id=${eventId} returning id`;
    await connection`update song_requests set event_participant_id=${member.id},status='pending',position=0,version=3 where id=${ids[0]}`;
    await connection`update song_requests set position=position-1 where event_id=${eventId} and status='approved'`;
    await connection`insert into operator_audit_log(actor_kind,operator_id,event_id,action,entity_id,payload)
      values('operator',${actor},${eventId},'event_queue_done',${String(ids[0])},'{"nextVersion":2}'::jsonb),
      ('operator',${actor},${eventId},'event_queue_restore',${String(ids[0])},'{"nextVersion":3}'::jsonb)`;
    expect((await snapshot()).items.find(r=>r.id===ids[0])?.completedCount).toBe(1);
    const store=await import('../../src/server/operator-api/fair-queue-store');
    const historical=await registry.pozaNutaDatabase!.transaction(tx=>store.loadFairQueueSnapshot(tx,eventId));expect(historical.requests.find(r=>r.id===ids[0])?.confirmedCompletionCount).toBe(1);
    await apply(await action(0,'approve'));await apply(await action(0,'start'));const finish=await action(0,'done');await apply(finish);await apply(finish);
    expect((await snapshot()).items.find(r=>r.id===ids[0])?.completedCount).toBe(2);
    const restore=await action(0,'done');await apply({...restore,action:'restore'});expect((await snapshot()).items.find(r=>r.id===ids[0])?.completedCount).toBe(2);
  });
  it('v2 previews explain decisions, fence stale applies and retain the collaboration receipt protocol',async()=>{
    vi.stubEnv('KUNESTU_FAIR_QUEUE_ENGINE','rotation-v2');
    try{
      const preview=await fair.previewFairEventQueue(scope);expect(preview.engine).toBe('rotation-v2');expect(preview.changes.every(x=>x.decision)).toBe(true);
      const op=await operation(0,5);await apply(op);await expect(fair.applyFairEventQueue({...scope,revision:preview.revision})).rejects.toMatchObject({code:'FAIR_QUEUE_PREVIEW_STALE'});
      const fresh=await fair.previewFairEventQueue(scope);await fair.applyFairEventQueue({...scope,revision:fresh.revision});
      const again=await apply(op);expect(again.replayed).toBe(true);
    }finally{vi.unstubAllEnvs();}
  });
  it.each(['approve','done'] as const)('v2 Fair Sort racing %s preserves all rows, receipts, positions and confirmation counts',async kind=>{
    vi.stubEnv('KUNESTU_FAIR_QUEUE_ENGINE','rotation-v2');
    try{
      if(kind==='approve'){const [p]=await connection`insert into song_requests(event_id,song_id,singer_name,display_name,status,position,requested_by) values(${eventId},${song},'New singer','New singer','pending',0,'operator') returning id::int`;ids.push(p.id);}
      const source=kind==='approve'?ids.length-1:0,op=await action(source,kind),preview=await fair.previewFairEventQueue(scope);
      const results=await Promise.allSettled([fair.applyFairEventQueue({...scope,revision:preview.revision}),apply(op)]);
      expect(results[1].status).toBe('fulfilled');if(results[0].status==='rejected')expect(results[0].reason).toMatchObject({code:'FAIR_QUEUE_PREVIEW_STALE'});
      const final=await snapshot(),approved=final.items.filter(r=>r.status==='approved').sort((a,b)=>a.position-b.position);
      expect(final.items).toHaveLength(ids.length);expect(approved.map(r=>r.position)).toEqual(approved.map((_,i)=>i+1));expect(final.items.filter(r=>r.status==='now')).toHaveLength(0);
      expect(final.items.find(r=>r.id===ids[source])?.status).toBe(kind==='approve'?'approved':'done');expect((await apply(op)).replayed).toBe(true);
      const [count]=await connection`select count(*)::int n from operator_audit_log where event_id=${eventId} and action='event_queue_performance_completed'`;
      expect(count.n).toBe(kind==='done'?1:0);
      if(kind==='approve'){
        expect(final.items.find(r=>r.id===ids[source])?.fairInsertion).toBeDefined();
        const restore=await action(source,'done');await apply({...restore,action:'restore'});
        const manual=await operation(source,1);
        await apply(manual);expect((await snapshot()).items.find(r=>r.id===ids[source])?.fairInsertion).toBeUndefined();
      }

    }finally{vi.unstubAllEnvs();}
  });
  it('v2 admission cannot pass a protected participant hidden behind a preserved existing pair',async()=>{
    vi.stubEnv('KUNESTU_FAIR_QUEUE_ENGINE','rotation-v2');
    try{
      const members:number[]=[];
      for(const name of ['High','Protected','New']){const [identity]=await connection`insert into participant_identities default values returning id`;const [member]=await connection`insert into event_participants(event_session_id,participant_id,display_name,normalized_display_name) select id,${identity.id},${name},${name.toLowerCase()} from event_sessions where event_id=${eventId} returning id::int`;members.push(member.id);}
      await connection`update song_requests set status='rejected',position=0 where event_id=${eventId} and id not in (${ids[0]},${ids[1]})`;
      for(const [index,member] of members.slice(0,2).entries())await connection`update song_requests set event_participant_id=${member},created_at=now()-interval '20 minutes' where id=${ids[index]}`;
      for(const [member,count] of [[members[0],3],[members[1],2]])for(let i=0;i<count;i++)await connection`insert into song_requests(event_id,song_id,event_participant_id,singer_name,display_name,status,position,requested_by,created_at,completed_at) values(${eventId},${song},${member},'Historical','Historical','done',0,'operator',now()-interval '20 minutes',now()-(${member===members[0]&&i===2?'5 minutes':'15 minutes'})::interval)`;
      await connection`insert into operator_audit_log(actor_kind,operator_id,event_id,action,entity_id,payload,created_at) values
        ('operator',${actor},${eventId},'event_queue_approve',${String(ids[0])},'{}',now()-interval '1 minute'),
        ('operator',${actor},${eventId},'event_queue_approve',${String(ids[1])},'{}',now()-interval '10 minutes'),
        ('operator',${actor},${eventId},'event_queue_fair_admission',${String(ids[1])},'{"protectionTurns":1}',now()-interval '10 minutes')`;
      const [pending]=await connection`insert into song_requests(event_id,song_id,event_participant_id,singer_name,display_name,status,position,requested_by) values(${eventId},${song},${members[2]},'New','New','pending',0,'operator') returning id::int`;ids.push(pending.id);
      await apply(await action(ids.length-1,'approve'));const approved=(await snapshot()).items.filter(r=>r.status==='approved').sort((a,b)=>a.position-b.position);
      expect(approved.map(r=>r.id)).toEqual([ids[0],ids[1],pending.id]);expect(approved[1].completedCount).toBe(2);expect(approved[2].fairInsertion?.constrained).toBe(true);
    }finally{vi.unstubAllEnvs();}
  });
  it('rebases two independent placements and preserves contiguous positions',async()=>{
    const [a,b]=await Promise.all([operation(0,5),operation(1,3,2)]);
    const results=await Promise.all([apply(a),apply(b,auth2)]);expect(results).toHaveLength(2);
    const s=await snapshot(),order=s.items.filter(x=>x.status==='approved').sort((a,b)=>a.position-b.position);
    expect(order.map(x=>x.position)).toEqual([1,2,3,4,5,6]);
    expect(order.findIndex(x=>x.id===ids[4])).toBeLessThan(order.findIndex(x=>x.id===ids[0]));
    expect(order.findIndex(x=>x.id===ids[0])).toBeLessThan(order.findIndex(x=>x.id===ids[5]));
    expect(order.findIndex(x=>x.id===ids[2])).toBeLessThan(order.findIndex(x=>x.id===ids[1]));
    expect(order.findIndex(x=>x.id===ids[1])).toBeLessThan(order.findIndex(x=>x.id===ids[3]));
  });
  it('returns one explicit conflict for contradictory concurrent moves of the same song',async()=>{
    const [a,b]=await Promise.all([operation(0,5),operation(0,3,2)]);
    const results=await Promise.allSettled([apply(a),apply(b,auth2)]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    const rejected=results.find(x=>x.status==='rejected');expect(rejected?.status==='rejected'&&rejected.reason).toMatchObject({code:'QUEUE_INTENT_CONFLICT'});
  });
  it('deduplicates simultaneous retries and returns current state for a lost old acknowledgement',async()=>{
    const op=await operation(0,5);const [a,b]=await Promise.all([apply(op),apply(op)]);
    expect([a.replayed,b.replayed].sort()).toEqual([false,true]);
    const next=await operation(1,2);await apply(next);
    const replay=await apply(op),s=await snapshot();expect(replay.revision).toBe(s.revision);expect(replay.acknowledged).toContain(op.operationId);
    const [count]=await connection`select count(*)::int n from operator_audit_log where event_id=${eventId} and action='event_queue_operation_confirmed' and payload->>'operationId'=${op.operationId}`;expect(count.n).toBe(1);
    await expect(apply({...op,sortRevision:'999'})).rejects.toEqual(code('QUEUE_OPERATION_REUSED'));
  });
  it('guards start versus start and never silently completes the winner',async()=>{
    const [a,b]=await Promise.all([action(0,'start'),action(1,'start',2)]);
    const results=await Promise.allSettled([apply(a),apply(b,auth2)]);expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.find(x=>x.status==='rejected')).toMatchObject({reason:{code:'QUEUE_PERFORMANCE_CONFLICT'}});
    expect((await snapshot()).items.filter(x=>x.status==='now')).toHaveLength(1);
    expect((await snapshot()).items.filter(x=>x.status==='done')).toHaveLength(0);
  });
  it('guards a stale done and allows deliberate start/done with fresh preconditions',async()=>{
    await apply(await action(0,'start'));const done=await action(0,'done');await apply(done);
    await expect(apply({...done,operationId:randomUUID()})).rejects.toEqual(code('QUEUE_INTENT_CONFLICT'));
    const s=await snapshot();expect(s.items.find(x=>x.id===ids[0])?.status).toBe('done');
  });
  it('detects a moved neighbour and a Fair Sort barrier without changing Fair mathematics',async()=>{
    const target=await operation(0,3);await apply(await operation(2,5,2),auth2);
    await expect(apply(target)).rejects.toEqual(code('QUEUE_ANCHOR_CONFLICT'));
    const before=await operation(0,4),preview=await fair.previewFairEventQueue(scope);
    await fair.applyFairEventQueue({...scope,revision:preview.revision});
    await expect(apply(before)).rejects.toEqual(code('QUEUE_INTENT_CONFLICT'));
  });
  it('rolls back mutation, receipt, stream revision and broadcast if the audit fails',async()=>{
    const op=await operation(0,5),before=await snapshot();
    await connection.unsafe(`create function public.test_collaboration_fail() returns trigger language plpgsql as $$ begin if new.action='event_queue_operation_confirmed' then raise exception 'synthetic audit fault'; end if; return new; end $$;
      create trigger test_collaboration_fail before insert on operator_audit_log for each row execute function public.test_collaboration_fail();`);
    try{await expect(apply(op)).rejects.toBeDefined();}finally{await connection.unsafe('drop trigger test_collaboration_fail on operator_audit_log');}
    const after=await snapshot();expect(after.revision).toBe(before.revision);expect(after.items).toEqual(before.items);
    expect((await snapshot(auth,device,[op.operationId])).acknowledged).toEqual([]);
    await apply(op);expect((await snapshot(auth,device,[op.operationId])).acknowledged).toEqual([op.operationId]);
  });
  it('coalesces row updates into one private broadcast per event transaction with no personal payload',async()=>{
    const before=await snapshot();await apply(await operation(0,6));const after=await snapshot();expect(BigInt(after.revision)).toBe(BigInt(before.revision)+1n);
    const messages=await connection`select payload from realtime.test_queue_messages where topic=${'dashboard:event:'+eventId+':queue'} and payload->>'revision'=${after.revision}`;
    expect(messages).toHaveLength(1);expect(Object.keys(messages[0].payload).sort()).toEqual(['changedAt','eventId','operation','revision','type']);
    const [rls]=await connection`select has_table_privilege('anon','queue_operation_receipts','SELECT') a,has_table_privilege('authenticated','queue_streams','UPDATE') b`;expect(rls).toEqual({a:false,b:false});
  });
  it('enforces actor/device binding, viewer RBAC, event and organization isolation',async()=>{
    const op=await operation(0,5);await expect(apply(op,auth2)).rejects.toEqual(code('QUEUE_ACTOR_CHANGED'));
    await expect(apply({...op,actorId:actor2},viewer)).rejects.toMatchObject({status:403});
    const other=randomUUID();await expect(service.applyQueueOperation({...scope,eventId:other},op)).rejects.toMatchObject({status:404});
    await expect(service.applyQueueOperation({...scope,organizationId:'otherworkspace000000'},op)).rejects.toMatchObject({status:403});
    await apply(op);expect((await snapshot(auth2,device,[op.operationId])).acknowledged).toEqual([]);
    expect((await snapshot(auth,device2,[op.operationId])).acknowledged).toEqual([]);
  });
  it('treats legacy manual movement as a conflicting decision but ignores mere renumbering',async()=>{
    const op=await operation(0,5);await legacy.moveDashboardOrganizationEventQueueRequestForAuthUser({...scope,requestId:ids[0],move:{targetPosition:3}});
    await expect(apply(op)).rejects.toEqual(code('QUEUE_INTENT_CONFLICT'));
    const next=await operation(1,5);await legacy.moveDashboardOrganizationEventQueueRequestForAuthUser({...scope,requestId:ids[3],move:{targetPosition:1}});
    await apply(next);
  });
});
