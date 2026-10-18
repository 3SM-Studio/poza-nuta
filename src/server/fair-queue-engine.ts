import {insertFairQueue,proposeFairQueue,type FairQueueRequest} from './fair-queue';
import {insertFairQueueV2,proposeFairQueueV2} from './fair-queue-v2';
export type FairQueueEngine = 'legacy' | 'rotation-v2';
/** Persisted event choice wins over rollout; legacy is the global emergency brake.
 * Missing event configuration means an older record/test fixture, never opt it in.
 */
export function fairEngine(configured?: FairQueueEngine): FairQueueEngine {
  const value=process.env.KUNESTU_FAIR_QUEUE_ENGINE;
  if(value!==undefined&&value!=='legacy'&&value!=='rotation-v2')throw new Error('Unknown Fair Queue engine');
  if(value==='legacy')return 'legacy';
  return configured??value??'legacy';
}
export function proposeQueue(snapshot:readonly FairQueueRequest[],engine:FairQueueEngine=fairEngine()){
  return engine==='rotation-v2'?proposeFairQueueV2(snapshot):{...proposeFairQueue(snapshot),decisions:undefined};
}
export function insertQueue(snapshot:readonly FairQueueRequest[],id:number,engine:FairQueueEngine=fairEngine()){
  return engine==='rotation-v2'?insertFairQueueV2(snapshot,id):{order:insertFairQueue(snapshot,id),decision:undefined,constrained:false};
}
