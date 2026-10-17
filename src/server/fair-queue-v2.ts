import type {FairQueueRequest} from './fair-queue';

export type FairDecision = {
  reason: 'protected'|'first'|'rotation'|'separation';
  completed: number; allocated: number; ordinal: number; otherTurns: number;
  protectionTurns: number; waitingSince: number|null; round: number;
};
export const fairOwner=(r:FairQueueRequest)=>r.participantId===null?`legacy:${r.id}`:`participant:${r.participantId}`;
export function admissionBudget(snapshot:readonly FairQueueRequest[],requestId:number){
 const source=snapshot.find(r=>r.id===requestId);if(!source)return 1;const owner=fairOwner(source);
 return Math.max(1,new Set(snapshot.filter(r=>['approved','now'].includes(r.status)&&fairOwner(r)!==owner).map(fairOwner)).size);
}
const admission=(a:FairQueueRequest,b:FairQueueRequest)=>a.approvedAt-b.approvedAt||a.id-b.id;
const position=(a:FairQueueRequest,b:FairQueueRequest)=>a.position-b.position||a.id-b.id;
export function performanceTimes(row:FairQueueRequest):readonly number[]{
  return row.confirmedCompletions??(row.status==='done'&&row.completedAt!==null?[row.completedAt]:[]);
}

/** No clock, random number, nickname or input array order participates in selection. */
export function proposeFairQueueV2(snapshot:readonly FairQueueRequest[],protectionMultiplier=1){
  if(!Number.isFinite(protectionMultiplier)||protectionMultiplier<=0)throw new Error('Invalid protection multiplier');
  const approved=snapshot.filter(x=>x.status==='approved').sort(admission);
  const totals=new Map<string,number>(),allocated=new Map<string,number>(),observedHistory=new Map<string,number>();
  const completions=snapshot.flatMap(r=>performanceTimes(r).map((at,index)=>({owner:fairOwner(r),at,requestId:r.id,index}))).sort((a,b)=>a.at-b.at||a.requestId-b.requestId||a.index-b.index);
  for(const r of snapshot){const k=fairOwner(r);totals.set(k,(totals.get(k)??0)+(r.confirmedCompletionCount??r.confirmedCompletions?.length??(r.status==='done'?1:0)));if(r.status==='now')allocated.set(k,(allocated.get(k)??0)+1);if(r.historyObservedAt!=null)observedHistory.set(k,Math.max(observedHistory.get(k)??0,r.historyObservedAt));}
  const activeOwners=new Set(snapshot.filter(r=>['approved','now'].includes(r.status)).map(fairOwner)).size;
  const previous=snapshot.filter(r=>r.status==='now').sort((a,b)=>(b.startedAt??b.createdAt)-(a.startedAt??a.createdAt)||b.id-a.id)[0];
  let last=previous?fairOwner(previous):completions.at(-1)?.owner??null;
  const ordinals=new Map<string,number>(),decisions=new Map<number,FairDecision>();
  const rows=approved.map(r=>{
    const k=fairOwner(r),ordinal=ordinals.get(k)??0;ordinals.set(k,ordinal+1);
    const lastOwn=completions.filter(c=>c.owner===k).at(-1)?.at;
    const anchor=r.waitingSince===null?null:Math.max(r.waitingSince,lastOwn??0,observedHistory.get(k)??0);
    const otherTurns=anchor===null?0:completions.filter(c=>c.owner!==k&&c.at>anchor).length;
    const protectionTurns=Math.max(1,Math.ceil((r.protectionTurns??Math.max(1,activeOwners-1))*protectionMultiplier));
    const decision:FairDecision={reason:'rotation',completed:totals.get(k)??0,allocated:allocated.get(k)??0,ordinal,otherTurns,protectionTurns,waitingSince:r.waitingSince,round:(totals.get(k)??0)+(allocated.get(k)??0)+ordinal};
    return {r,k,decision};
  });
  const groups=new Map<string,typeof rows>();
  for(const row of rows){const group=groups.get(row.k)??[];group.push(row);groups.set(row.k,group);}
  const order:number[]=[];
  while(order.length<rows.length){
    // Only one head per identity is eligible. A second queued song cannot jump its first.
    const heads=[...groups.values()].flatMap(group=>group.length?[group[0]]:[]);
    const protection=(x:typeof heads[number])=>x.decision.waitingSince!==null&&x.decision.otherTurns>=x.decision.protectionTurns;
    heads.sort((a,b)=>Number(protection(b))-Number(protection(a))||
      (protection(a)&&protection(b)?admission(a.r,b.r):a.decision.round-b.decision.round||a.decision.ordinal-b.decision.ordinal||admission(a.r,b.r)));
    const ideal=heads[0],next=heads.find(x=>x.k!==last)??ideal;
    next.decision.reason=next!==ideal?'separation':protection(next)?'protected':next.decision.completed+next.decision.allocated===0&&next.decision.ordinal===0?'first':'rotation';
    decisions.set(next.r.id,next.decision);order.push(next.r.id);groups.get(next.k)!.shift();last=next.k;
  }
  return {order,decisions};
}

/** Stable constrained insertion. Full sort ranking is the shared preference, manual pairs win. */
export function insertFairQueueV2(snapshot:readonly FairQueueRequest[],requestId:number){
  const proposal=proposeFairQueueV2(snapshot),rank=new Map(proposal.order.map((id,i)=>[id,i]));
  const inserted=snapshot.find(r=>r.id===requestId&&r.status==='approved');if(!inserted)throw new Error('Approved insertion required');
  const existing=snapshot.filter(r=>r.status==='approved'&&r.id!==requestId).sort(position),k=fairOwner(inserted);
  const ownFloor=existing.reduce((n,r,i)=>fairOwner(r)===k?i+1:n,0);
  // Preserve every existing pair, but never let new admissions repeatedly pass
  // an already protected head just because those existing pairs oppose rank.
  const minimum=existing.reduce((n,r,i)=>{
    const d=proposal.decisions.get(r.id)!;
    return d.ordinal===0&&d.waitingSince!==null&&d.otherTurns>=d.protectionTurns?Math.max(n,i+1):n;
  },ownFloor);
  let best=minimum,cost=Infinity;
  for(let i=minimum;i<=existing.length;i++){
    const inversions=existing.reduce((n,r,j)=>n+Number(j<i?rank.get(r.id)!>rank.get(requestId)!:rank.get(r.id)!<rank.get(requestId)!),0);
    if(inversions<cost){cost=inversions;best=i;}
  }
  const order=existing.map(r=>r.id);order.splice(best,0,requestId);
  return {order,decision:proposal.decisions.get(requestId)!,constrained:order.indexOf(requestId)!==rank.get(requestId)};
}
