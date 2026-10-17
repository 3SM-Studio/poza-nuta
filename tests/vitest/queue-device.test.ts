import {expect,it} from 'vitest';
import {claimQueueDevice} from '@/components/operator/queue-device';

it('preserves a reload identity but gives a copied sessionStorage a distinct exclusive writer',async()=>{
  const owned=new Set<string>();
  const locks={async request(name:string,_options:{ifAvailable:true},callback:(lock:Lock|null)=>Promise<void>){
    const available=!owned.has(name);if(available)owned.add(name);
    await callback(available?{name,mode:'exclusive'}:null);
  }};
  const existing='00000000-0000-4000-8000-000000000001';
  const storage=(initial:string)=>{let id=initial;return {getItem:()=>id,setItem:(_key:string,value:string)=>{id=value;}};};
  const original=storage(existing),copied=storage(existing);
  expect(await claimQueueDevice(original,locks)).toBe(existing);
  const copyId=await claimQueueDevice(copied,locks);expect(copyId).not.toBe(existing);expect(copied.getItem()).toBe(copyId);
  owned.clear();expect(await claimQueueDevice(original,locks)).toBe(existing);
});
it('fails closed when local device storage or the exclusive lease cannot be acquired',async()=>{
  const storage={getItem:()=>null,setItem:()=>{throw new Error('Storage denied');}};
  const locks={async request(name:string,_options:{ifAvailable:true},callback:(lock:Lock|null)=>Promise<void>){await callback({name,mode:'exclusive'});}};
  await expect(claimQueueDevice(storage,locks)).rejects.toThrow('Storage denied');
  await expect(claimQueueDevice({...storage,setItem:()=>{}},{request:async()=>{throw new Error('Lease denied');}})).rejects.toThrow('Lease denied');
});
