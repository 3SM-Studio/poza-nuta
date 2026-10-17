'use client';
import { useEffect, useRef, useState } from 'react';
import { getQueueDevice } from './queue-device';
import { QueueCollaboration, type QueueCollaborationState } from '@/lib/queue-collaboration';
import { getQueueSync, sendQueueOperation, type DashboardEventQueueItemDto } from './event-queue-api';
import { loadQueueOutbox, persistQueueOutbox } from './queue-outbox';
import { realtimeDiagnostic } from '@/lib/realtime-diagnostics';

// Responsive layouts may mount the same route more than once. They must share
// a single outbox writer/transport for this tab, never overwrite each other's log.
const controllers=new Map<string,{client:QueueCollaboration;references:number}>();

export function useQueueCollaboration(organizationId:string,eventId:string,initialItems:DashboardEventQueueItemDto[]) {
  const [client,setClient]=useState<QueueCollaboration|null>(null);
  const [deviceId,setDeviceId]=useState('');
  const sourceItems=useRef(initialItems);
  const [state,setState]=useState<QueueCollaborationState>({items:initialItems,entries:[],unconfirmedIds:[],revision:'0',sortRevision:'0',ready:false,online:true,error:null,closed:false});
  useEffect(()=>{
    let mounted=true,release:(()=>void)|undefined;
    void getQueueDevice().then(deviceId=>{
    if(!mounted)return;
    const controllerKey=`${organizationId}:${eventId}:${deviceId}`;
    let shared=controllers.get(controllerKey);
    if(!shared){const client=new QueueCollaboration(sourceItems.current,{
      deviceId,online:()=>navigator.onLine,
      snapshot:async(ids,signal)=>{
        const snapshot=await getQueueSync(organizationId,eventId,deviceId,ids,signal);
        realtimeDiagnostic('snapshot_ok');
        return snapshot;
      },
      send:(op,signal)=>sendQueueOperation(organizationId,eventId,op,signal),
      load:actor=>loadQueueOutbox(`${actor}:${organizationId}:${eventId}:${deviceId}`),
      persist:(actor,entries)=>persistQueueOutbox(`${actor}:${organizationId}:${eventId}:${deviceId}`,entries),
    });shared={client,references:0};controllers.set(controllerKey,shared);void client.start();}
    shared.references++;
    const c=shared.client;
    const unsubscribe=c.subscribe(()=>setState(c.getSnapshot()));
    // Initial source items are only a loading view. Mutations wait for an authorised actor/snapshot.
    queueMicrotask(()=>{if(mounted){setClient(c);setDeviceId(deviceId);setState(c.getSnapshot());}});
    const online=()=>c.reconnect();
    const unload=(event:BeforeUnloadEvent)=>{if(c.getSnapshot().entries.length){event.preventDefault();}};
    window.addEventListener('online',online);window.addEventListener('offline',online);window.addEventListener('beforeunload',unload);
    release=()=>{unsubscribe();if(--shared.references===0){c.stop();controllers.delete(controllerKey);}window.removeEventListener('online',online);window.removeEventListener('offline',online);window.removeEventListener('beforeunload',unload);};
    }).catch(()=>{if(mounted)setState(previous=>({...previous,error:'Nie można bezpiecznie otworzyć lokalnego magazynu kolejki. Użyj przeglądarki z obsługą Web Locks i IndexedDB.',ready:false}));});
    return()=>{mounted=false;release?.();};
    // Server revalidation must not discard an active device's pending intent log.
  },[organizationId,eventId]);
  return {client,state,deviceId};
}
