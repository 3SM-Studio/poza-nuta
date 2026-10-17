import { parseQueueOperation } from '@/lib/queue-operation';
import type { OutboxEntry } from '@/lib/queue-collaboration';

const databaseName='kunestu-queue-outbox-v1';
async function database() {
  return new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open(databaseName,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('outbox');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('Local queue storage unavailable'));
  });
}
export async function loadQueueOutbox(scope:string):Promise<OutboxEntry[]> {
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('outbox','readonly'),request=tx.objectStore('outbox').get(scope);
    request.onerror=()=>reject(new Error('Cannot restore queue outbox'));
    request.onsuccess=()=>{
      const value:unknown=request.result??[];
      if(!Array.isArray(value)||value.length>64){reject(new Error('Invalid stored queue outbox'));return;}
      const entries:OutboxEntry[]=[];
      for(const entry of value){
        if(!entry||typeof entry!=='object'){reject(new Error('Invalid stored queue entry'));return;}
        const op=parseQueueOperation(entry.operation);
        if(!op||typeof entry.changedAt!=='string'||!Number.isFinite(Date.parse(entry.changedAt))||!['queued','sending','uncertain','conflict'].includes(entry.phase)){
          reject(new Error('Invalid stored queue intent'));return;
        }
        entries.push({operation:op,changedAt:entry.changedAt,phase:entry.phase,attempts:0,error:typeof entry.error==='string'?entry.error:undefined});
      }
      resolve(entries);
    };
  });}finally{db.close();}
}
export async function persistQueueOutbox(scope:string,entries:OutboxEntry[]) {
  const db=await database();
  try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('outbox','readwrite');tx.objectStore('outbox').put(entries,scope);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('Cannot persist queue intent'));tx.onabort=()=>reject(new Error('Queue persistence aborted'));
  });}finally{db.close();}
}
