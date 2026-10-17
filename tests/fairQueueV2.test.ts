import assert from 'node:assert/strict';
import test from 'node:test';
import {proposeFairQueueV2,insertFairQueueV2} from '../src/server/fair-queue-v2.ts';
import type {FairQueueRequest} from '../src/server/fair-queue.ts';
const row=(id:number,owner=id,patch:Partial<FairQueueRequest>={}):FairQueueRequest=>({id,participantId:owner,status:'approved',position:id,createdAt:id,approvedAt:id,waitingSince:id,startedAt:null,completedAt:null,protectionTurns:3,...patch});
const done=(id:number,owner:number,at=id)=>row(id,owner,{status:'done',completedAt:at});
test('v2 newcomers beat unprotected repeated histories without erasing completed rounds',()=>{
 const rows=[row(1,1,{approvedAt:100,waitingSince:100}),row(2,2,{approvedAt:101,waitingSince:101}),...Array.from({length:5},(_,i)=>done(10+i,1,10+i))];
 assert.equal(proposeFairQueueV2(rows).order[0],2);assert.equal(proposeFairQueueV2(rows).decisions.get(1)?.completed,5);
});
test('v2 a protected head beats arbitrarily many new first songs after one recorded admission cycle',()=>{
 const rows=[row(1,1),...Array.from({length:5},(_,i)=>done(10+i,1,0)),...Array.from({length:3},(_,i)=>done(20+i,20+i,100+i)),...Array.from({length:100},(_,i)=>row(100+i,100+i,{approvedAt:1000+i,waitingSince:1000+i}))];
 assert.equal(proposeFairQueueV2(rows).order[0],1);assert.equal(proposeFairQueueV2(rows).decisions.get(1)?.reason,'protected');
});
test('v2 current now is reserved; only alternatives split adjacent songs; a single singer can continue',()=>{
 assert.deepEqual(proposeFairQueueV2([row(1,1),row(2,1)]).order,[1,2]);
 assert.deepEqual(proposeFairQueueV2([row(1,1),row(2,2),row(3,1,{status:'now'})]).order,[2,1]);
});
test('v2 immutable confirmed performances survive restore and do not count cancelled starts',()=>{
 const rows=[row(1,1,{status:'pending',confirmedCompletions:[10,20]}),row(2,1),row(3,2,{status:'skipped',confirmedCompletions:[]}),row(4,2)];
 assert.equal(proposeFairQueueV2(rows).decisions.get(2)?.completed,2);assert.equal(proposeFairQueueV2(rows).decisions.get(4)?.completed,0);
});
test('v2 no fabricated waiting credit for missing approval; every manual existing pair survives insert',()=>{
 const rows=[row(1,1,{position:3,waitingSince:null}),row(2,2,{position:1}),row(3,3,{position:2}),row(4,4)];
 assert.deepEqual(insertFairQueueV2(rows,4).order.filter(x=>x!==4),[2,3,1]);assert.equal(proposeFairQueueV2(rows).decisions.get(1)?.otherTurns,0);
});
test('v2 generated properties: permutation, determinism, owner FIFO, no avoidable repeats, rename-independent metadata',()=>{
 let seed=9137;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
 for(let run=0;run<150;run++){
  const rows=Array.from({length:1+random()%60},(_,i)=>row(i+1,random()%9,{approvedAt:random()%1000,waitingSince:0}));
  const a=proposeFairQueueV2(rows).order,b=proposeFairQueueV2([...rows].reverse()).order;assert.deepEqual(a,b);assert.equal(new Set(a).size,rows.length);
  const queued=new Map<number,number[]>();for(const r of [...rows].sort((x,y)=>x.approvedAt-y.approvedAt||x.id-y.id)){const q=queued.get(r.participantId!)??[];q.push(r.id);queued.set(r.participantId!,q);}
  let previous:number|null=null;
  for(const id of a){const r=rows.find(x=>x.id===id)!;assert.equal(queued.get(r.participantId!)!.shift(),id);if(r.participantId===previous)assert.ok([...queued].every(([owner,q])=>owner===previous||q.length===0));previous=r.participantId;}
  const sorted=rows.map(r=>({...r,position:a.indexOf(r.id)+1}));assert.deepEqual(proposeFairQueueV2(sorted).order,a);
 }
});

test('v2 equal completion timestamps use immutable request IDs rather than SQL input order',()=>{
 const rows=[row(1,1),row(2,2),done(11,1,100),done(12,2,100)];
 assert.deepEqual(proposeFairQueueV2(rows).order,proposeFairQueueV2([...rows].reverse()).order);
});

test('v2 unknown historical completion time counts history without inventing waiting turns',()=>{
 const rows=[row(1,1),row(2,2),row(3,2,{status:'pending',confirmedCompletions:[],confirmedCompletionCount:4})];
 const result=proposeFairQueueV2(rows);assert.equal(result.decisions.get(2)?.completed,4);assert.equal(result.decisions.get(1)?.otherTurns,0);
});

test('v2 unlinked legacy rows have independent identities even when stored labels coincide',()=>{
 const rows=[row(1,1,{participantId:null}),row(2,2,{participantId:null}),done(3,3)];rows[2]={...rows[2],participantId:null};
 const result=proposeFairQueueV2(rows);assert.deepEqual(result.order,[1,2]);assert.equal(result.decisions.get(1)?.completed,0);assert.equal(result.decisions.get(2)?.completed,0);
});

test('v2 undated historical confirmations anchor waiting at their observation, not an invented performance time',()=>{
 const rows=[row(1,1,{waitingSince:0}),row(2,1,{status:'pending',confirmedCompletions:[],confirmedCompletionCount:1,historyObservedAt:200}),done(3,2,100),done(4,3,250)];
 assert.equal(proposeFairQueueV2(rows).decisions.get(1)?.otherTurns,1);
});

test('v2 new insert cannot overtake a protected head even when preserved older pairs oppose full-sort rank',()=>{
 const rows=[row(1,20,{position:1,approvedAt:1000,waitingSince:1000}),row(2,10,{position:2,waitingSince:1,protectionTurns:1}),row(3,40,{position:3,approvedAt:2000,waitingSince:2000}),done(10,10,0),done(11,10,0),done(12,20,0),done(13,20,0),done(14,20,0),done(15,30,100)];
 assert.deepEqual(proposeFairQueueV2(rows).order,[2,3,1]);assert.deepEqual(insertFairQueueV2(rows,3).order,[1,2,3]);
});
