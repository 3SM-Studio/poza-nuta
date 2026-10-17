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
  await installPostgresCompatibilityFixture(connection);await applyPostgresMigrations(connection,32);
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
