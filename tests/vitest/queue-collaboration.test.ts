import {queueOperationDiagnosticReport} from '../../src/lib/queue-operation-diagnostics';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueueCollaboration, replayQueueIntent, createQueueOperation, type OutboxEntry } from '../../src/lib/queue-collaboration';
import { parseQueueOperation, resolveQueueOperationPosition } from '../../src/lib/queue-operation';
import type { DashboardEventQueueItemDto, QueueSyncSnapshot } from '../../src/components/operator/event-queue-api';

const clients:QueueCollaboration[]=[];
afterEach(()=>{clients.forEach(c=>c.stop());clients.length=0;vi.useRealTimers();});
const device='00000000-0000-4000-8000-000000000001';
function item(id:number,status:DashboardEventQueueItemDto['status']='approved'):DashboardEventQueueItemDto {
  return {id,eventId:1,songId:id,singerName:`Singer ${id}`,displayName:`Singer ${id}`,note:null,status,position:id,
    version:1,intentVersion:0,createdAt:'2026-10-17T12:00:00Z',updatedAt:'2026-10-17T12:00:00Z',startedAt:null,completedAt:null,
    requestedBy:'operator',song:{title:`Song ${id}`,artist:'Artist',source:'manual',durationSeconds:180}};
}
async function setup(items=[item(1),item(2),item(3)],stored:OutboxEntry[]=[]){
  let server:QueueSyncSnapshot={actorId:1,eventId:1,revision:'1',sortRevision:'0',items,acknowledged:[],canManage:true,lifecycle:'active'};
  let durable=stored;
  const snapshot=vi.fn(async()=>server);
  const send=vi.fn((_op:Parameters<QueueCollaboration['enqueue']>[0],signal:AbortSignal)=>new Promise<QueueSyncSnapshot>((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})));
  const persist=vi.fn(async(_actor:number,entries:OutboxEntry[])=>{durable=structuredClone(entries);});
  const online=vi.fn(()=>true);
  const c=new QueueCollaboration(items,{deviceId:device,online,snapshot,send,load:async()=>stored,persist});clients.push(c);
  await c.start();await new Promise(resolve=>setTimeout(resolve,0));
  const operation=(requestId:number,position:number)=>createQueueOperation(c.getSnapshot().items,device,1,c.getSnapshot().sortRevision,requestId,{kind:'placement',lane:'approved',position})!;
  return {c,send,snapshot,persist,online,operation,get durable(){return durable;},setServer(s:Partial<QueueSyncSnapshot>){server={...server,...s};}};
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

describe('semantic queue protocol',()=>{
  it('restores a version-one 401 without inventing a new operation or replaying automatically',async()=>{
    const first=await setup(),operation=first.operation(1,3);first.c.stop();
    const t=await setup(undefined,[{operation,phase:'conflict',changedAt:new Date().toISOString(),attempts:1,error:'Zaloguj się ponownie. Zmiana zachowana.'}]);
    expect(t.c.getSnapshot().entries[0]).toMatchObject({phase:'conflict',errorStatus:401,operation});expect(t.send).not.toHaveBeenCalled();
    await t.c.retryAuthorization(operation.operationId);await flush();expect(t.send.mock.calls[0][0]).toEqual(operation);
  });
  it('retains a 401 intent and retries the exact operation only after same-actor authentication',async()=>{
    const t=await setup(),op=t.operation(1,3);
    t.send.mockRejectedValueOnce(Object.assign(new Error('Session expired'),{status:401}));
    t.c.enqueue(op);await flush();await flush();
    expect(t.c.getSnapshot().entries[0]).toMatchObject({phase:'conflict',errorStatus:401});
    expect(t.send).toHaveBeenCalledTimes(1);expect(t.durable[0].operation.operationId).toBe(op.operationId);
    await t.c.retryAuthorization(op.operationId);await flush();
    expect(t.send).toHaveBeenCalledTimes(2);expect(t.send.mock.calls[1][0]).toEqual(op);
  });
  it('never replays a 403 or an old-account 401 intent after an actor switch',async()=>{
    for(const status of [401,403]){
      const t=await setup(),op=t.operation(1,3);t.send.mockRejectedValueOnce(Object.assign(new Error('Denied'),{status}));
      t.c.enqueue(op);await flush();await flush();
      if(status===401)t.setServer({actorId:2,revision:'2'});
      await t.c.retryAuthorization(op.operationId);await flush();
      expect(t.send).toHaveBeenCalledTimes(1);expect(t.c.getSnapshot().entries).toHaveLength(1);
    }
  });
  it('strictly validates operation shape, actor, UUIDs and neighbours',async()=>{
    const t=await setup(),op=t.operation(1,3);expect(parseQueueOperation(op)).toEqual(op);
    for(const bad of [{...op,actorId:0},{...op,operationId:'guess'},{...op,role:'owner'}, {...op,before:{id:1,intentVersion:0}}, {...op,expectedIntentVersion:-1},{...op,lane:['approved']},{...op,expectedStatus:['approved']}])expect(parseQueueOperation(bad)).toBeNull();
  });
  it('rebases a gap over an unrelated insertion without relying on numeric positions',async()=>{
    const t=await setup([item(1),item(2),item(3),item(4)]),op=t.operation(1,2);
    if(op.kind!=='placement')throw new Error('placement');
    expect(resolveQueueOperationPosition([item(1),item(2),{...item(5),position:2.5},item(3),item(4)],op)).toBe(3);
    expect(resolveQueueOperationPosition([item(1),item(2),{...item(3),intentVersion:1},item(4)],op)).toBeNull();
    expect(resolveQueueOperationPosition([item(1),item(2),{...item(3),status:'now'},item(4)],op)).toBeNull();
  });
});
describe('local queue outbox',()=>{
  it('bounds transport retries and preserves the identical operation ID after repeated server failures',async()=>{
    const t=await setup();vi.useFakeTimers();t.send.mockRejectedValue(Object.assign(new Error('Unavailable'),{status:503}));const op=t.operation(1,3);t.c.enqueue(op);
    await vi.advanceTimersByTimeAsync(2500);expect(t.send).toHaveBeenCalledTimes(3);await vi.advanceTimersByTimeAsync(20000);expect(t.send).toHaveBeenCalledTimes(3);
    expect(t.send.mock.calls.every(x=>x[0].operationId===op.operationId)).toBe(true);expect(t.c.getSnapshot().entries[0].phase).toBe('uncertain');
  });
  it('updates locally synchronously and sends independent requests concurrently',async()=>{
    const t=await setup([item(1,'pending'),item(2,'pending'),item(3,'pending')]);
    for(const id of [1,2,3])t.c.enqueue(createQueueOperation(t.c.getSnapshot().items,device,1,'0',id,{kind:'action',action:'approve'})!);
    expect(t.c.getSnapshot().items.every(x=>x.status==='approved')).toBe(true);
    expect(t.send).not.toHaveBeenCalled();await flush();expect(t.send).toHaveBeenCalledTimes(3);
    expect(t.c.getSnapshot().entries.every(x=>x.phase==='sending')).toBe(true);expect(t.durable).toHaveLength(3);
  });
  it('does not let another failing operation restart exhausted automatic retries',async()=>{
    const t=await setup([item(1,'pending'),item(2,'pending')]);vi.useFakeTimers();
    t.send.mockRejectedValue(Object.assign(new Error('Unavailable'),{status:503}));
    for(const id of [1,2]){
      t.c.enqueue(createQueueOperation(t.c.getSnapshot().items,device,1,'0',id,{kind:'action',action:'approve'})!);
      await vi.advanceTimersByTimeAsync(2500);
    }
    expect(t.send.mock.calls.filter(([op])=>op.requestId===1)).toHaveLength(3);
    expect(t.send.mock.calls.filter(([op])=>op.requestId===2)).toHaveLength(3);
    expect(t.c.getSnapshot().entries.every(x=>x.phase==='uncertain')).toBe(true);
  });
  it('preserves order for dependent movements while allowing independent work',async()=>{
    const t=await setup(Array.from({length:8},(_,i)=>item(i+1)));
    t.c.enqueue(t.operation(1,3));await flush();t.c.enqueue(t.operation(1,5));
    t.c.enqueue(createQueueOperation(t.c.getSnapshot().items,device,1,'0',8,{kind:'action',action:'reject'})!);await flush();
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(t.c.getSnapshot().entries.map(x=>x.phase)).toEqual(['sending','queued','sending']);
  });
  it('serializes performance intentions without serializing independent approvals',async()=>{
    const t=await setup([item(1),item(2),item(3,'pending')]);
    for(const id of [1,2])t.c.enqueue(createQueueOperation(t.c.getSnapshot().items,device,1,'0',id,{kind:'action',action:'start'})!);
    t.c.enqueue(createQueueOperation(t.c.getSnapshot().items,device,1,'0',3,{kind:'action',action:'approve'})!);await flush();
    expect(t.send).toHaveBeenCalledTimes(2);expect(t.send.mock.calls.map(x=>x[0].requestId)).toEqual([1,3]);
  });
  it('accepts remote state while an HTTP mutation is pending and replays its intent',async()=>{
    const t=await setup([item(1,'pending'),item(2,'pending')]);const op=createQueueOperation(t.c.getSnapshot().items,device,1,'0',1,{kind:'action',action:'approve'})!;
    t.c.enqueue(op);await flush();t.setServer({revision:'2',items:[item(1,'pending'),{...item(2),position:1,intentVersion:1}]});await t.c.refresh();
    expect(t.c.getSnapshot().items.every(x=>x.status==='approved')).toBe(true);expect(t.c.getSnapshot().entries).toHaveLength(1);
  });
  it('never regresses to an older snapshot or drops unacknowledged work',async()=>{
    const t=await setup();t.setServer({revision:'3',items:[{...item(1),position:3},{...item(2),position:1},{...item(3),position:2}]});await t.c.refresh();
    t.setServer({revision:'2',items:[item(1),item(2),item(3)]});await t.c.refresh();
    expect(t.c.getSnapshot().revision).toBe('3');expect(t.c.getSnapshot().items.find(x=>x.id===1)?.position).toBe(3);
  });
  it('does not locally replace a newly reported performance with an old unconfirmed start',async()=>{
    const t=await setup([item(1),item(2),item(3,'now')]);t.online.mockReturnValue(false);
    t.c.enqueue(createQueueOperation(t.c.getSnapshot().items,device,1,'0',1,{kind:'action',action:'start'})!);
    expect(t.c.getSnapshot().items.find(x=>x.status==='now')?.id).toBe(1);
    t.setServer({revision:'2',items:[item(1),{...item(2,'now'),intentVersion:1},{...item(3,'done'),intentVersion:1}]});await t.c.refresh();
    expect(t.c.getSnapshot().items.find(x=>x.status==='now')?.id).toBe(2);
    expect(t.c.getSnapshot().entries).toHaveLength(1);
  });
  it('retains but does not overlay a placement across a newer Fair Sort barrier',async()=>{
    const t=await setup();t.online.mockReturnValue(false);t.c.enqueue(t.operation(1,3));
    t.setServer({revision:'2',sortRevision:'9',items:[item(1),item(2),item(3)]});await t.c.refresh();
    expect(t.c.getSnapshot().items.find(x=>x.id===1)?.position).toBe(1);
    expect(t.c.getSnapshot().entries).toHaveLength(1);
  });
  it('reconciles a committed operation from an API receipt even when its response is lost',async()=>{
    const t=await setup([item(1,'pending')]);const op=createQueueOperation(t.c.getSnapshot().items,device,1,'0',1,{kind:'action',action:'approve'})!;
    t.c.enqueue(op);await flush();t.setServer({revision:'2',acknowledged:[op.operationId],items:[{...item(1),position:1,intentVersion:1}]});await t.c.refresh();
    expect(t.c.getSnapshot().entries).toHaveLength(0);expect(t.c.getSnapshot().items[0].status).toBe('approved');
  });
  it('preserves a conflict in durable storage and does not overlay the remote decision',async()=>{
    const t=await setup([item(1,'pending')]);t.send.mockRejectedValueOnce(Object.assign(new Error('Conflict'),{status:409}));
    const op=createQueueOperation(t.c.getSnapshot().items,device,1,'0',1,{kind:'action',action:'approve'})!;
    t.setServer({revision:'2',items:[{...item(1,'rejected'),intentVersion:1}]});t.c.enqueue(op);await flush();await flush();
    expect(t.c.getSnapshot().entries[0].phase).toBe('conflict');expect(t.c.getSnapshot().items[0].status).toBe('rejected');
    expect(t.durable[0].operation.operationId).toBe(op.operationId);
    t.c.discard(op.operationId);expect(t.c.getSnapshot().entries).toHaveLength(0);
  });
  it('does not permit discarding an ambiguous or in-flight commit',async()=>{
    const t=await setup(),op=t.operation(1,3);t.c.enqueue(op);await flush();t.c.discard(op.operationId);
    expect(t.c.getSnapshot().entries).toHaveLength(1);
  });
  it('persists offline operations and resumes the same operation ID after reconnect',async()=>{
    const t=await setup();t.online.mockReturnValue(false);const op=t.operation(1,3);t.c.enqueue(op);await flush();
    expect(t.send).not.toHaveBeenCalled();expect(t.durable[0].operation.operationId).toBe(op.operationId);
    t.online.mockReturnValue(true);t.c.reconnect();await flush();expect(t.send.mock.calls[0][0].operationId).toBe(op.operationId);
  });
  it('retains unsaved work and blocks its POST when local persistence fails',async()=>{
    const t=await setup();t.persist.mockRejectedValueOnce(new Error('Disk full'));t.c.enqueue(t.operation(1,3));await flush();
    expect(t.send).not.toHaveBeenCalled();expect(t.c.getSnapshot().entries).toHaveLength(1);expect(t.c.getSnapshot().error).toContain('lokalnych operacji');
  });
  it('stops operations after an authorised snapshot reports closure or changed account',async()=>{
    const t=await setup();t.setServer({lifecycle:'closed',revision:'2'});await t.c.refresh();expect(t.c.getSnapshot().closed).toBe(true);
    expect(t.c.enqueue(t.operation(1,3))).toBe(false);
    t.setServer({lifecycle:'active',revision:'3'});await t.c.refresh();expect(t.c.getSnapshot().closed).toBe(false);
    t.setServer({actorId:2,revision:'4'});await t.c.refresh();expect(t.c.getSnapshot().closed).toBe(true);
  });
});

it('preserves untouched row identity during replay, but updates target and old performance versions',async()=>{
  const rows=[item(1),item(2),item(3),item(4)];
  const operation=createQueueOperation(rows,device,1,'0',1,{kind:'placement',lane:'approved',position:2})!;
  const next=replayQueueIntent(rows,{operation,changedAt:rows[0].updatedAt,phase:'queued',attempts:0});
  expect(next.find(x=>x.id===3)).toBe(rows[2]);expect(next.find(x=>x.id===4)).toBe(rows[3]);
  expect(next.find(x=>x.id===1)?.intentVersion).toBe(1);expect(next.find(x=>x.id===2)?.intentVersion).toBe(0);
  const stage=[item(1,'now'),item(2)];
  const start=createQueueOperation(stage,device,1,'0',2,{kind:'action',action:'start'})!;
  expect(replayQueueIntent(stage,{operation:start,phase:'queued',attempts:0,changedAt:rows[0].updatedAt}).map(x=>x.intentVersion)).toEqual([1,1]);
});
it('shares identical snapshot DTOs and still observes nested metadata additions/changes',async()=>{
  const t=await setup();const before=t.c.getSnapshot().items;
  t.setServer({items:structuredClone(before),revision:'2'});await t.c.refresh();
  expect(t.c.getSnapshot().items[0]).toBe(before[0]);
  const changed=structuredClone(before);changed[0].song.title='Changed';
  changed[1].nicknameChanges=[{before:'Old',after:'New',at:'2026-10-18T00:00:00Z'}];
  t.setServer({items:changed,revision:'3'});await t.c.refresh();
  expect(t.c.getSnapshot().items[0].song.title).toBe('Changed');expect(t.c.getSnapshot().items[1].nicknameChanges).toEqual(changed[1].nicknameChanges);
  expect(t.c.getSnapshot().items[2]).toBe(before[2]);
});

it('does not mislabel stale snapshots or a pending overlay as confirmed peer convergence',async()=>{
  const t=await setup();const operation=t.operation(1,3);
  const trace={operationId:operation.operationId,requestId:device,revision:'2'};
  t.setServer({revision:'2',trace});await t.c.refresh();t.c.enqueue(operation);
  t.c.markRendered('2',false);expect(queueOperationDiagnosticReport().filter(x=>x.operationId===operation.operationId&&x.stage==='rendered')).toHaveLength(0);
  t.c.markRendered('2',true);let records=queueOperationDiagnosticReport().filter(x=>x.operationId===operation.operationId&&x.stage==='rendered');
  expect(records.at(-1)?.pending).toBe(true);
  t.setServer({revision:'2',trace,acknowledged:[operation.operationId]});await t.c.refresh();t.c.markRendered('2');
  records=queueOperationDiagnosticReport().filter(x=>x.operationId===operation.operationId&&x.stage==='rendered');expect(records.at(-1)?.pending).toBe(false);
  t.setServer({revision:'1',trace:null});await t.c.refresh();t.c.markRendered('1');
  expect(t.c.getRevision()).toBe('2');expect(queueOperationDiagnosticReport().some(x=>x.stage==='stale_snapshot'&&x.revision==='1')).toBe(true);
  expect(queueOperationDiagnosticReport().filter(x=>x.operationId===operation.operationId&&x.stage==='rendered')).toHaveLength(2);
});
