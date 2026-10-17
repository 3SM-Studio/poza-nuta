type Request = {id:number;status:string;completedAt:number|null};
type Audit = {id:number;action:string;entityId:string|null;createdAt:number;payload:Record<string,unknown>|null};
const versionKey=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?`version:${value}`:null;

/** Confirmed facts, including original explicit done audits; never infer identity or elapsed time. */
export function performanceHistory(rows:readonly Request[],audits:readonly Audit[]){
 const facts=new Map<number,Map<string,number|null>>(),observations=new Map<number,Map<string,number>>(),evidence=new Map<number,number>(),lifecycle=new Map<number,number>();
 const record=(id:number,audit:Audit,key:string,at:number|null)=>{
  const list=facts.get(id)??new Map<string,number|null>(),observed=observations.get(id)??new Map<string,number>();
  if(!list.has(key)||list.get(key)===null)list.set(key,at);
  if(list.get(key)===null)observed.set(key,audit.createdAt);else observed.delete(key);
  facts.set(id,list);observations.set(id,observed);evidence.set(id,audit.id);
 };
 for(const audit of [...audits].sort((a,b)=>a.id-b.id)){
  const id=Number(audit.entityId);if(!Number.isSafeInteger(id)||id<1)continue;
  // A historical restore explicitly observed a done source. Recover its fact,
  // but not a completion date, unless an intervening confirmation already did.
  if(audit.action==='event_queue_restore'&&audit.payload?.previousStatus==='done'&&
    (!(facts.get(id)?.size)||(lifecycle.get(id)??0)>(evidence.get(id)??0)))
    record(id,audit,versionKey(audit.payload.previousVersion)??`audit:${audit.id}`,null);
  if(['event_queue_start','event_queue_restore','event_queue_done'].includes(audit.action))lifecycle.set(id,audit.id);
  if(audit.action!=='event_queue_done'&&audit.action!=='event_queue_performance_completed')continue;
  const key=versionKey(audit.payload?.[audit.action==='event_queue_done'?'nextVersion':'requestVersion'])??`audit:${audit.id}`;
  record(id,audit,key,audit.payload?.timeKnown===false?null:audit.createdAt);
 }
 return new Map(rows.map(row=>{
  const list=facts.get(row.id)??new Map<string,number|null>();
  // Old implicit finish had no per-request completion audit. A current done row
  // proves one additional fact only after a newer lifecycle action (or no facts).
  const unrecordedCurrent=row.status==='done'&&(!list.size||(lifecycle.get(row.id)??0)>(evidence.get(row.id)??0));
  const times=[...list.values()].filter((at):at is number=>at!==null);
  if(unrecordedCurrent&&row.completedAt!==null)times.push(row.completedAt);
  const observed=[...(observations.get(row.id)?.values()??[])];
  return [row.id,{count:list.size+Number(unrecordedCurrent),times,unrecordedCurrent,observedAt:observed.length?Math.max(...observed):null}];
 }));
}
