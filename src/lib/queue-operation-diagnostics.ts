import {isQueueOperationId} from './queue-operation.ts';

type Stage='local'|'snapshot'|'stale_snapshot'|'realtime'|'rendered';
type Correlation={scope:string;revision?:string;operationId?:string;requestId?:string;pending?:boolean};
type Entry=Correlation & {stage:Stage;at:number};
const entries:Entry[]=[];
const stages=new Set<Stage>(['local','snapshot','stale_snapshot','realtime','rendered']);
// Always available, memory only, bounded to 128 records / 30 minutes.
// No payloads, event names, device IDs, credentials, search terms or network calls.
export function queueOperationDiagnostic(stage:Stage,fields:Correlation){
  if(!stages.has(stage)||!isQueueOperationId(fields.scope))return;
  if(fields.revision!==undefined&&!/^\d{1,20}$/.test(fields.revision))return;
  if(fields.operationId!==undefined&&!isQueueOperationId(fields.operationId))return;
  if(fields.requestId!==undefined&&!isQueueOperationId(fields.requestId))return;
  entries.push({stage,at:Date.now(),scope:fields.scope,
    ...(fields.revision!==undefined?{revision:fields.revision}:{}),
    ...(fields.operationId?{operationId:fields.operationId}:{}),
    ...(fields.requestId?{requestId:fields.requestId}:{}),
    ...(typeof fields.pending==='boolean'?{pending:fields.pending}:{})});
  prune();
}
function prune(){while(entries.length&&(entries.length>128||entries[0].at<Date.now()-30*60_000))entries.shift();}
export function queueOperationDiagnosticReport(){prune();return entries.map(entry=>({...entry}));}
export function installQueueOperationDiagnostics(){
  if(typeof window!=='undefined')window.kunestuQueueDiagnostics??={report:queueOperationDiagnosticReport};
}
declare global{interface Window{kunestuQueueDiagnostics?:{report:typeof queueOperationDiagnosticReport}}}
