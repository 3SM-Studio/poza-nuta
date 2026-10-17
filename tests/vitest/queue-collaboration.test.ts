import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueueCollaboration, createQueueOperation, type OutboxEntry } from '../../src/lib/queue-collaboration';
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
