import {insertFairQueue,proposeFairQueue,type FairQueueRequest} from './fair-queue';
import {insertFairQueueV2,proposeFairQueueV2} from './fair-queue-v2';
export function fairEngine(){
  const value=process.env.KUNESTU_FAIR_QUEUE_ENGINE??'legacy';
  if(value!=='legacy'&&value!=='rotation-v2')throw new Error('Unknown Fair Queue engine');
  return value;
}
export function proposeQueue(snapshot:readonly FairQueueRequest[]){
  return fairEngine()==='rotation-v2'?proposeFairQueueV2(snapshot):{...proposeFairQueue(snapshot),decisions:undefined};
}
export function insertQueue(snapshot:readonly FairQueueRequest[],id:number){
  return fairEngine()==='rotation-v2'?insertFairQueueV2(snapshot,id):{order:insertFairQueue(snapshot,id),decision:undefined,constrained:false};
}
