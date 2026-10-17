import assert from 'node:assert/strict';
import test from 'node:test';
import {performanceHistory} from '../src/server/performance-history.ts';
const row=(status='pending')=>({id:1,status,completedAt:30});
const audit=(id:number,action:string,payload:Record<string,unknown>={},createdAt=id)=>({id,action,payload,createdAt,entityId:'1'});
test('original explicit done remains a confirmed fact after a historical restore',()=>{
 const result=performanceHistory([row()],[audit(1,'event_queue_done',{nextVersion:2}),audit(2,'event_queue_restore')]).get(1)!;
 assert.equal(result.count,1);assert.deepEqual(result.times,[1]);assert.equal(result.unrecordedCurrent,false);
});
test('new confirmation and explicit action share a version, not two performances',()=>{
 const result=performanceHistory([row('done')],[audit(1,'event_queue_performance_completed',{requestVersion:2}),audit(2,'event_queue_done',{nextVersion:2})]).get(1)!;
 assert.equal(result.count,1);assert.equal(result.unrecordedCurrent,false);
});
test('an old implicit current finish is observed once and survives restore without erasing earlier explicit facts',()=>{
 const past=[audit(1,'event_queue_done',{nextVersion:2}),audit(2,'event_queue_restore'),audit(3,'event_queue_start')];
 assert.equal(performanceHistory([row('done')],past).get(1)?.count,2);
 const persisted=[...past,audit(4,'event_queue_performance_completed',{requestVersion:5},30),audit(5,'event_queue_restore')];
 assert.equal(performanceHistory([row()],persisted).get(1)?.count,2);
});
test('unknown completion dates stay unknown; IDs and input order cannot merge separate facts',()=>{
 const rows=[{...row('done'),completedAt:null},{...row(),id:2}];
 const result=performanceHistory(rows,[audit(1,'event_queue_performance_completed',{requestVersion:2,timeKnown:false})]);
 assert.equal(result.get(1)?.count,1);assert.deepEqual(result.get(1)?.times,[]);assert.equal(result.get(2)?.count,0);
});

test('historical restore from done recovers an undated implicit finish, while cancelling now invents none',()=>{
 const old=[audit(1,'event_queue_start'),audit(2,'event_queue_restore',{previousStatus:'done',previousVersion:2})];
 const result=performanceHistory([row()],old).get(1)!;assert.equal(result.count,1);assert.deepEqual(result.times,[]);assert.equal(result.observedAt,2);
 assert.equal(performanceHistory([row()],[audit(1,'event_queue_start'),audit(2,'event_queue_restore',{previousStatus:'now',previousVersion:2})]).get(1)?.count,0);
});
