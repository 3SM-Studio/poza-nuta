import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {proposeFairQueue,insertFairQueue,type FairQueueRequest} from '../src/server/fair-queue.ts';
import {proposeFairQueueV2,insertFairQueueV2} from '../src/server/fair-queue-v2.ts';
type Strategy='baseline'|'fair-share'|'hybrid';
function select(rows:FairQueueRequest[],strategy:Strategy,multiplier=1){
 if(strategy==='baseline')return proposeFairQueue(rows).order;
 if(strategy==='hybrid')return proposeFairQueueV2(rows,multiplier).order;
 const withoutCredit=rows.map(r=>({...r,waitingSince:null}));return proposeFairQueue(withoutCredit).order;
}
function simulation(strategy:Strategy,multiplier=1,continuous=false,stableInsert=false){
 const rows:FairQueueRequest[]=[],waits:number[]=[],first:number[]=[],later:number[]=[],gaps:number[]=[];
 const byAppearance=new Map<number,number[]>();
 const played=new Map<number,number>(),lastTurn=new Map<number,number>();let nextId=1,movement=0,avoidableRepeat=0,maxBacklog=0;
 const currentOrder=()=>stableInsert?rows.filter(r=>r.status==='approved').sort((a,b)=>a.position-b.position||a.id-b.id).map(r=>r.id):select(rows,strategy,multiplier);
 const place=(r:FairQueueRequest)=>{
  rows.push(r);if(!stableInsert)return;
  const order=strategy==='hybrid'?insertFairQueueV2(rows,r.id).order:insertFairQueue(strategy==='fair-share'?rows.map(row=>({...row,waitingSince:null})):rows,r.id);
  const positions=new Map(order.map((id,i)=>[id,i+1]));
  for(let i=0;i<rows.length;i++)if(rows[i].status==='approved')rows[i]={...rows[i],position:positions.get(rows[i].id)!};
 };
 for(let turn=0;turn<180;turn++){
  const owners=turn<16?[turn+1]:continuous?[1000+turn]:turn%3===0?[1+turn%16]:[];
  for(const owner of owners){
   const before=currentOrder();const id=nextId++,budget=Math.max(1,new Set(rows.filter(r=>r.status==='approved'&&r.participantId!==owner).map(r=>r.participantId)).size);
   place({id,participantId:owner,status:'approved',position:id,createdAt:turn*180000,approvedAt:turn*180000,waitingSince:turn*180000,startedAt:null,completedAt:null,protectionTurns:budget});
   // Frozen exogenous arrivals: this is a model, not a claim about human behaviour.
   if(turn<16)for(let extra=0;extra<2;extra++)place({...rows.at(-1)!,id:nextId++,approvedAt:turn*180000+extra+1,createdAt:turn*180000+extra+1});
   const after=currentOrder();movement+=before.reduce((n,id,i)=>n+Number(after.indexOf(id)!==i),0);
  }
  const order=currentOrder(),id=order[0];maxBacklog=Math.max(maxBacklog,order.length);if(!id)continue;
  const selected=rows.find(r=>r.id===id)!,owner=selected.participantId!;const at=(turn+1)*180000;
  const waiting=(turn*180000-selected.approvedAt)/60000;waits.push(waiting);(played.has(owner)?later:first).push(waiting);
  if(lastTurn.has(owner)){const gap=turn-lastTurn.get(owner)!-1;gaps.push(gap);if(gap===0&&order.some(id=>rows.find(r=>r.id===id)!.participantId!==owner))avoidableRepeat++;}
  const appearance=(played.get(owner)??0)+1;const group=byAppearance.get(appearance)??[];group.push(waiting);byAppearance.set(appearance,group);
  played.set(owner,appearance);lastTurn.set(owner,turn);rows[rows.indexOf(selected)]={...selected,status:'done',completedAt:at};
 }
 const stats=(values:number[])=>{const s=[...values].sort((a,b)=>a-b),p=(n:number)=>s[Math.max(0,Math.ceil(s.length*n)-1)]??0;return {samples:s.length,mean:s.reduce((a,b)=>a+b,0)/Math.max(1,s.length),median:p(.5),p90:p(.9),p95:p(.95),max:s.at(-1)??0};};
 const unserved=rows.filter(r=>r.status==='approved');
 return {strategy,model:stableInsert?'stable-insert':'full-sort-each-turn',multiplier,continuous,censoredAgeMinutes:stats(unserved.map(r=>(180*180000-r.approvedAt)/60000)),unservedFirst:unserved.filter(r=>!played.has(r.participantId!)).length,byAppearance:Object.fromEntries([...byAppearance].map(([n,v])=>[n,stats(v)])),waitMinutes:stats(waits),firstMinutes:stats(first),laterMinutes:stats(later),foreignPerformanceGaps:stats(gaps),over30Minutes:waits.filter(x=>x>30).length,avoidableRepeat,movement,maxBacklog,unserved:unserved.length};
}
const results=(['baseline','fair-share','hybrid'] as const).flatMap(s=>[simulation(s),simulation(s,1,true),simulation(s,1,false,true),simulation(s,1,true,true)]);
const sensitivity=[.5,1,2].map(m=>simulation('hybrid',m,true));
const load=[];for(const size of [20,50,100,1000]){const rows=Array.from({length:size},(_,i)=>({id:i+1,participantId:i%Math.ceil(size/2),status:'approved' as const,position:i+1,createdAt:i,approvedAt:i,waitingSince:i,startedAt:null,completedAt:null,protectionTurns:Math.max(1,Math.ceil(size/2)-1)}));const times=[];for(let run=0;run<10;run++){const at=performance.now();proposeFairQueueV2(rows);insertFairQueueV2(rows,size);times.push(performance.now()-at);}times.sort((a,b)=>a-b);load.push({size,combinedSortInsertP95Ms:times.at(-1)});}
const report={capturedUtc:new Date().toISOString(),source:'synthetic only; no event #46 export available',method:'fixed exogenous admissions; synthetic 3-minute service slots; wait measured to service start; alternate decisions do not predict actual human behaviour',historicalReplay:{performed:false,reason:'No authorised project-scoped data connector or anonymised event timeline available'},results,sensitivity,load};
writeFileSync('.artifacts/fair-queue-comparison.json',JSON.stringify(report,null,2));
let md='# Fair Queue strategy comparison\n\nSynthetic controlled simulation; no production event replay is claimed. See methodology in the integration ADR.\n\n| Strategy / execution model | Continuous arrivals | Mean wait min | P95 wait min | Max min | Unserved (first) | Max censored age min | Avoidable repeats | Position shifts |\n|---|---|---:|---:|---:|---:|---:|---:|---:|\n';
for(const r of results)md+=`| ${r.strategy} / ${r.model} | ${r.continuous} | ${r.waitMinutes.mean.toFixed(2)} | ${r.waitMinutes.p95.toFixed(2)} | ${r.waitMinutes.max.toFixed(2)} | ${r.unserved} (${r.unservedFirst}) | ${r.censoredAgeMinutes.max.toFixed(2)} | ${r.avoidableRepeat} | ${r.movement} |\n`;
md+='\nRaw distributions, first/later waits, foreign-song gaps, threshold sensitivity and engine timings: `.artifacts/fair-queue-comparison.json`. This fixed workload does not establish universal dominance. Median/P90/P95, censored/unserved requests and first/later groups must be read together. Position shifts measure absolute index changes at admission in the selected execution model; constrained insertion preserves existing relative pairs. Waiting is admission to service start, excluding service duration.\n';
md+='\nFull-sort-each-turn assumes explicit global re-sorting after every service/admission; stable-insert models normal automatic admissions without those global sorts or invented operator choices. The two models are separate. All strategies use the same exogenous arrivals within each model.\n';
md+='\n## First versus later performances (completed requests only)\n\n| Strategy / execution model | Continuous | First median / P95 / max min | Later median / P95 / max min | Foreign-performance gap P95 / max |\n|---|---|---:|---:|---:|\n';
for(const r of results)md+=`| ${r.strategy} / ${r.model} | ${r.continuous} | n=${r.firstMinutes.samples}: ${r.firstMinutes.median.toFixed(2)} / ${r.firstMinutes.p95.toFixed(2)} / ${r.firstMinutes.max.toFixed(2)} | n=${r.laterMinutes.samples}: ${r.laterMinutes.median.toFixed(2)} / ${r.laterMinutes.p95.toFixed(2)} / ${r.laterMinutes.max.toFixed(2)} | ${r.foreignPerformanceGaps.p95} / ${r.foreignPerformanceGaps.max} |\n`;
md+='\n## Protection sensitivity (synthetic continuous arrivals)\n\n| Frozen-roster multiplier | First P95 min | Later P95 min | Max wait min | Unserved | Max censored age min |\n|---|---:|---:|---:|---:|---:|\n';
for(const r of sensitivity)md+=`| ${r.multiplier} | ${r.firstMinutes.p95} | ${r.laterMinutes.p95.toFixed(2)} | ${r.waitMinutes.max.toFixed(2)} | ${r.unserved} | ${r.censoredAgeMinutes.max} |\n`;
md+='\n## Pure engine load (sort plus constrained insert, ten samples; two active songs per identity)\n\n| Approved rows | Nearest-rank P95 ms |\n|---|---:|\n';for(const r of load)md+=`| ${r.size} | ${r.combinedSortInsertP95Ms?.toFixed(3)} |\n`;
md+='\nThe hybrid is a conservative policy candidate, not an empirical winner on every metric. It retains true completed rounds and grants a separate, auditable protection lane after an observed roster cycle. The fair-share comparison can report excellent served-only latency while repeatedly bypassing old second songs; censored age exposes that failure. The hybrid can worsen newcomer and maximum wait. A finite simulation cannot prove eventual service under unlimited arrivals. No strategy can empty a queue whose arrival rate exceeds service. Synthetic service duration is fixed for comparability and is never an algorithm input.\n';
writeFileSync('docs/features/fair-queue-v2-comparison.md',md);
console.log(JSON.stringify({scenarios:results.length,sensitivity:sensitivity.length,load}));
