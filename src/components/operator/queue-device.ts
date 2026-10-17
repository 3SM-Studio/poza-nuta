import {isQueueOperationId} from '@/lib/queue-operation';

type DeviceStorage = Pick<Storage,'getItem'|'setItem'>;
type DeviceLocks = {request(name:string,options:{ifAvailable:true},callback:(lock:Lock|null)=>Promise<void>):Promise<void>};
const key='kunestu-queue-device-v1';
let device:Promise<string>|undefined;

/** A copied sessionStorage must never give two documents ownership of one outbox. */
export function claimQueueDevice(storage:DeviceStorage,locks:DeviceLocks):Promise<string> {
  return new Promise((resolve,reject)=>{
    const saved=storage.getItem(key);
    const attempt=(id:string)=>{
      void locks.request(`kunestu-queue-device:${id}`,{ifAvailable:true},async lock=>{
        if(!lock){attempt(crypto.randomUUID());return;}
        storage.setItem(key,id);resolve(id);
        // The browser releases this lease on document termination, including crashes.
        await new Promise<void>(()=>{});
      }).catch(reject);
    };
    attempt(isQueueOperationId(saved)?saved:crypto.randomUUID());
  });
}

export function getQueueDevice():Promise<string> {
  if(!device)device=Promise.resolve().then(()=>{
    if(!navigator.locks)throw new Error('Exclusive local storage ownership is unavailable.');
    return claimQueueDevice(sessionStorage,navigator.locks);
  });
  return device;
}
