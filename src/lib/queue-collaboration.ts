import {queueOperationDiagnostic} from './queue-operation-diagnostics.ts';
import { applyOptimisticDashboardEventQueueAction, applyOptimisticDashboardEventQueueMoveToPosition } from './dashboard-event-queue-optimistic.ts';
import { queueAnchor, resolveQueueOperationPosition, type QueueOperation } from './queue-operation.ts';
import type { DashboardEventQueueItemDto, QueueSyncSnapshot } from '../components/operator/event-queue-api';

export type OutboxEntry = { operation: QueueOperation; changedAt: string; phase: 'queued'|'sending'|'uncertain'|'conflict'; attempts: number; error?: string; errorStatus?:number };
export type QueueCollaborationState = {
  items: DashboardEventQueueItemDto[]; entries: OutboxEntry[]; revision: string; sortRevision: string;
  ready: boolean; online: boolean; error: string|null; closed: boolean;
  unconfirmedIds: number[];
};
type Dependencies = {
  deviceId: string; online: () => boolean;
  snapshot: (ids:string[],signal:AbortSignal)=>Promise<QueueSyncSnapshot>;
  send: (op:QueueOperation,signal:AbortSignal)=>Promise<QueueSyncSnapshot>;
  load: (actorId:number)=>Promise<OutboxEntry[]>;
  persist: (actorId:number,entries:OutboxEntry[])=>Promise<void>;
};

function operationFailureMessage(error:unknown,status:number){
  const code=typeof error==='object'&&error!==null&&'code'in error?String(error.code):'';
  if(code==='SESSION_REQUEST_LIMIT_REACHED')return 'Ta osoba ma już 2 aktywne zgłoszenia. Zmiana zachowana; zakończ lub odrzuć jedno przed przywróceniem kolejnego.';
  if(code==='QUEUE_ACTIVE_DUPLICATE')return 'Ta osoba ma już aktywne zgłoszenie tej piosenki. Zmiana zachowana.';
  if(code==='QUEUE_PERFORMANCE_CONFLICT')return 'Aktualny występ zmienił się u innego operatora. Sprawdź scenę. Zmiana zachowana.';
  if(code==='EVENT_QUEUE_CLOSED')return 'Wydarzenie zostało zamknięte. Zmiana zachowana.';
  if(code==='QUEUE_ACTOR_CHANGED')return 'Zmieniono konto operatora. Zmiana zachowana dla pierwotnego konta.';
  if(status===401)return 'Zaloguj się ponownie. Zmiana zachowana.';
  if(status===403)return 'Nie masz uprawnień do zarządzania tą kolejką. Zmiana zachowana.';
  return 'Konflikt lub odmowa zapisu. Zmiana zachowana do decyzji.';
}

export function replayQueueIntent(items: DashboardEventQueueItemDto[], entry: OutboxEntry) {
  const op=entry.operation, source=items.find(x=>x.id===op.requestId);
  if (entry.phase==='conflict' || !source || source.status!==op.expectedStatus || (source.intentVersion??0)!==op.expectedIntentVersion) return items;
  if(op.kind==='action'&&op.action==='start'){
    const now=items.find(x=>x.status==='now');
    if((now?.id??null)!==(op.expectedNow?.id??null)||(now&&(now.intentVersion??0)!==op.expectedNow?.intentVersion))return items;
  }
  let next=items;
  if(op.kind==='action') next=applyOptimisticDashboardEventQueueAction(items,op.requestId,op.action,entry.changedAt);
  else {
    const position=op.lane==='approved'?resolveQueueOperationPosition(items,op):1;
    if(position===null)return items;
    if(source.status!==op.lane)next=applyOptimisticDashboardEventQueueAction(items,op.requestId,op.lane==='approved'?'approve':op.lane==='pending'?'restore':'reject',entry.changedAt);
    if(op.lane==='approved')next=applyOptimisticDashboardEventQueueMoveToPosition(next,op.requestId,position,entry.changedAt);
  }
  const previous = new Map(items.map(item=>[item.id,item]));
  return next.map(item=>{
    const original=previous.get(item.id);
    const intentVersion=(original?.intentVersion??0)+(item.id===op.requestId||original?.status!==item.status?1:0);
    return item.intentVersion===intentVersion?item:{...item,intentVersion};
  });
}

/** Local intent log over a monotonic, server-authoritative base. No network await in enqueue. */
export class QueueCollaboration {
  private diagnosticScope=crypto.randomUUID();
  private trace:QueueSyncSnapshot['trace'];
  private renderedState:string|undefined;
  markRealtime=(revision:string)=>queueOperationDiagnostic('realtime',{scope:this.diagnosticScope,revision});
  markRendered=(revision:string,pending=this.entries.length>0)=>{
    const renderedState=`${revision}:${this.entries.length>0}`;
    if(revision!==this.revision||pending!==(this.entries.length>0)||renderedState===this.renderedState)return;
    this.renderedState=renderedState;
    queueOperationDiagnostic('rendered',{scope:this.diagnosticScope,revision,...this.trace,pending:this.entries.length>0});
  };
  private base: DashboardEventQueueItemDto[];
  private entries: OutboxEntry[]=[];
  private listeners=new Set<()=>void>();
  private inflight=new Map<string,QueueOperation>();
  private controllers=new Set<AbortController>();
  private actorId: number|null=null;
  private revision='0'; private sortRevision='0'; private ready=false; private closed=false;
  private error:string|null=null; private active=true; private refreshing=false; private refreshAgain=false;
  private persistence:Promise<void>=Promise.resolve(); private persisted=new Set<string>();
  private retryTimer:ReturnType<typeof setTimeout>|undefined;
  private starting=false;
  private state:QueueCollaborationState;
  constructor(initialItems:DashboardEventQueueItemDto[],private deps:Dependencies) {
    this.base=initialItems;this.state=this.makeState();
  }
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  getSnapshot=()=>this.state;
  getRevision=()=>this.revision;
  getActorId=()=>this.actorId;
  private makeState():QueueCollaborationState {
    const items=this.entries.reduce((rows,entry)=>entry.operation.kind==='placement'&&entry.operation.sortRevision!==this.sortRevision?rows:replayQueueIntent(rows,entry),this.base);
    const ids=new Set(this.entries.filter(x=>x.phase!=='conflict').map(x=>x.operation.requestId));
    const baseById=new Map(this.base.map(item=>[item.id,item]));
    for(const item of items)if(baseById.get(item.id)?.status!==item.status)ids.add(item.id);
    return {items,entries:[...this.entries],unconfirmedIds:[...ids],
      revision:this.revision,sortRevision:this.sortRevision,ready:this.ready,online:this.deps.online(),error:this.error,closed:this.closed};
  }
  private publish(){if(!this.active)return;this.state=this.makeState();this.listeners.forEach(f=>f());}
  private controller(){const c=new AbortController();this.controllers.add(c);return c;}
  async start(){
    if(this.starting||!this.active)return;
    this.starting=true;const c=this.controller();const timeout=setTimeout(()=>c.abort(),12000);
    try {
      const s=await this.deps.snapshot([],c.signal);if(!this.active)return;
      this.actorId=s.actorId;
      this.entries=(await this.deps.load(s.actorId)).map(x=>({...x,phase:x.phase==='conflict'?'conflict':'queued',
        // Version-one outboxes stored this exact canonical message, not a status.
        // Keep the conflict/manual decision; this grants no automatic replay.
        errorStatus:x.errorStatus??(x.phase==='conflict'&&x.error==='Zaloguj się ponownie. Zmiana zachowana.'?401:undefined)}));
      if(!this.active)return;
      this.entries.forEach(e=>this.persisted.add(e.operation.operationId));
      this.accept(s);this.ready=true;this.publish();
      // A previous tab lifetime may have committed before its HTTP acknowledgement.
      await this.refresh();this.pump();
    }catch{if(this.active){this.error='Nie udało się odtworzyć synchronizacji. Lokalne operacje pozostają zachowane.';this.publish();}}
    finally{clearTimeout(timeout);this.starting=false;this.controllers.delete(c);}
  }
  private accept(s:QueueSyncSnapshot){
    if(this.actorId!==s.actorId){this.closed=true;this.error='Zmieniono konto operatora. Lokalne operacje zachowano dla pierwotnego konta.';this.publish();throw new Error('Queue actor changed');}
    queueOperationDiagnostic(BigInt(s.revision)<BigInt(this.revision)?'stale_snapshot':'snapshot',
      {scope:this.diagnosticScope,revision:s.revision,...s.trace});
    const ack=new Set(s.acknowledged);
    this.entries=this.entries.filter(x=>!ack.has(x.operation.operationId));
    if(BigInt(s.revision)>=BigInt(this.revision)){// DTOs are JSON values from the API. Preserve unchanged rows across snapshots,
      // including nested history, without ignoring future/additive display fields.
      const previous=new Map(this.base.map(item=>[item.id,item]));
      this.base=s.items.map(item=>{const old=previous.get(item.id);return old&&JSON.stringify(old)===JSON.stringify(item)?old:item;});this.revision=s.revision;this.sortRevision=s.sortRevision;this.trace=s.trace?.revision===s.revision?s.trace:null;
      if(s.canManage!==undefined&&s.lifecycle!==undefined)this.closed=!s.canManage||s.lifecycle!=='active';}
    this.save();this.publish();
  }
  private save(){
    if(this.actorId===null)return;
    const entries=this.entries.map(e=>({...e})),actor=this.actorId;
    this.persistence=this.persistence.then(()=>this.deps.persist(actor,entries)).then(()=>{
      entries.forEach(e=>this.persisted.add(e.operation.operationId));this.pump();
    }).catch(()=>{this.error='Nie udało się zapisać lokalnych operacji. Nie zamykaj tej karty; ponów zapis.';this.publish();});
  }
  enqueue(op:QueueOperation){
    if(!this.ready||this.closed||this.entries.length>=64){this.error='Nie można dodać operacji. Sprawdź synchronizację i zachowane zmiany.';this.publish();return false;}
    this.entries.push({operation:op,phase:'queued',attempts:0,changedAt:new Date().toISOString()});
    queueOperationDiagnostic('local',{scope:this.diagnosticScope,operationId:op.operationId,revision:this.revision});
    this.error=null;this.publish();this.save();return true;
  }
  private blocked(op:QueueOperation,index:number){
    const ids=new Set([op.requestId,...(op.kind==='placement'?[op.before?.id,op.after?.id]:op.action==='start'?[op.expectedNow?.id]:[])]);
    const critical=(x:QueueOperation)=>x.kind==='action'&&['start','done'].includes(x.action);
    return this.entries.slice(0,index).some(e=>ids.has(e.operation.requestId)||(critical(op)&&critical(e.operation))) ||
      [...this.inflight.values()].some(x=>ids.has(x.requestId)||(critical(op)&&critical(x)));
  }
  private pump(){
    if(!this.active||!this.ready||!this.deps.online()||this.closed)return;
    for(let i=0;i<this.entries.length&&this.inflight.size<4;i++){
      const e=this.entries[i],id=e.operation.operationId;
      if(e.phase!=='queued'||!this.persisted.has(id)||this.blocked(e.operation,i))continue;
      this.inflight.set(id,e.operation);e.phase='sending';this.publish();void this.transmit(e);
    }
  }
  private async transmit(entry:OutboxEntry){
    const id=entry.operation.operationId,c=this.controller();
    const timeout=setTimeout(()=>c.abort(),12000);
    try{const s=await this.deps.send(entry.operation,c.signal);if(this.active){this.error=null;this.accept(s);}}
    catch(error){
      if(!this.active)return;
      const e=this.entries.find(x=>x.operation.operationId===id);if(!e)return;
      const status=typeof error==='object'&&error!==null&&'status'in error?Number(error.status):0;
      e.attempts++;
      if(status>=400&&status<500&&status!==408&&status!==429){
        e.phase='conflict';e.error=operationFailureMessage(error,status);e.errorStatus=status;
      }else{e.phase='uncertain';e.error='Brak potwierdzenia serwera. Operacja zachowana; ponowienie jest bezpieczne.';
        if(e.attempts<3&&this.deps.online()){clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>this.retryUncertain(false),250*2**e.attempts);}}
      this.save();this.publish();void this.refresh();
    }finally{clearTimeout(timeout);this.controllers.delete(c);this.inflight.delete(id);this.pump();}
  }
  async refresh(){
    if(!this.active)return;
    if(!this.ready){return;}
    if(this.refreshing){this.refreshAgain=true;return;}
    this.refreshing=true;const c=this.controller();const timeout=setTimeout(()=>c.abort(),12000);
    try{const s=await this.deps.snapshot(this.entries.map(x=>x.operation.operationId),c.signal);if(this.active){this.error=null;this.accept(s);}}
    catch{if(this.active){this.error='Nie udało się zsynchronizować kolejki. Lokalne zmiany pozostają zachowane.';this.publish();}}
    finally{clearTimeout(timeout);this.controllers.delete(c);this.refreshing=false;if(this.refreshAgain){this.refreshAgain=false;void this.refresh();}}
  }
  retryUncertain(resetAttempts=true){this.entries.forEach(e=>{if(e.phase==='uncertain'&&(resetAttempts||e.attempts<3)){e.phase='queued';if(resetAttempts)e.attempts=0;}});this.save();this.publish();void this.refresh();this.pump();}
  async retryAuthorization(id:string){
    // Revalidate the original actor; preserve operation ID and CAS on retry.
    await this.refresh();
    if(this.error||this.closed)return;
    const e=this.entries.find(x=>x.operation.operationId===id);
    if(!e||e.phase!=='conflict'||e.errorStatus!==401||this.inflight.has(id))return;
    e.phase='queued';e.attempts=0;delete e.error;delete e.errorStatus;
    this.save();this.publish();
  }
  discard(id:string){
    const e=this.entries.find(x=>x.operation.operationId===id);
    // Never discard an ambiguous commit or an in-flight operation. Confirm via its receipt first.
    if(!e||e.phase!=='conflict'||this.inflight.has(id))return;
    this.entries=this.entries.filter(x=>x!==e);this.save();this.publish();this.pump();
  }
  reconnect(){this.publish();if(!this.ready)void this.start();else this.retryUncertain();}
  stop(){this.active=false;clearTimeout(this.retryTimer);this.controllers.forEach(c=>c.abort());this.listeners.clear();}
}

export function createQueueOperation(items:DashboardEventQueueItemDto[],deviceId:string,actorId:number,sortRevision:string,requestId:number,
  intent:{kind:'action';action:import('./dashboard-event-queue').DashboardEventQueueAction}|{kind:'placement';lane:import('./queue-placement').QueueLane;position:number;confirmed?:boolean}):QueueOperation|null {
  const source=items.find(x=>x.id===requestId);if(!source)return null;
  const common={operationId:crypto.randomUUID(),deviceId,actorId,requestId,expectedStatus:source.status,expectedIntentVersion:source.intentVersion??0,sortRevision};
  if(intent.kind==='action')return {...common,...intent,expectedNow:intent.action==='start'?queueAnchor(items.find(x=>x.status==='now')):null};
  const rows=items.filter(x=>x.status==='approved'&&x.id!==requestId).sort((a,b)=>a.position-b.position||a.id-b.id),index=intent.position-1;
  return {...common,kind:'placement',lane:intent.lane,before:queueAnchor(rows[index]),after:queueAnchor(rows[index-1]),confirmed:intent.confirmed===true};
}
