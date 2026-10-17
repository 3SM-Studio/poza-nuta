import {expect,test,type Page} from '@playwright/test';
import type {createClient,RealtimeChannel,SupabaseClient} from '@supabase/supabase-js';
import postgres from 'postgres';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createLocalSupabaseFixture} from './local-supabase-fixture';
declare global {interface Window {
 supabase:{createClient:typeof createClient};
 scopeClient:SupabaseClient;
 scopeChannels:RealtimeChannel[];
 scopeSignals:Record<string,unknown>[];
}}

test('Realtime scope: isolated organization A cannot receive B signals after 0035; public and own channels survive',async({browser})=>{
 test.setTimeout(180000);
 const a=await createLocalSupabaseFixture(),b=await createLocalSupabaseFixture();
 const sql=postgres(process.env.LOCAL_E2E_DATABASE_URL!,{max:1,onnotice:()=>{}});
 const ca=await browser.newContext(),cb=await browser.newContext(),anonymous=await browser.newContext();
 const pa=await ca.newPage(),pb=await cb.newPage(),pp=await anonymous.newPage();
 const fix=readFileSync('drizzle/0035_dashboard_queue_channel_scope.sql','utf8');
 const [eb]=await sql`select id from events where public_id=${b.eventPublicId}::uuid`;
 const topic=`dashboard:event:${eb.id}:queue`,participants=`dashboard:event:${eb.id}:participants`;
 const evidence:Record<string,unknown>={utc:new Date().toISOString(),localOnly:true,physicalDevice:false};
 async function client(p:Page,credentials?:{email:string;password:string}){
  await p.goto('/sign-in');await p.addScriptTag({path:resolve('node_modules/@supabase/supabase-js/dist/umd/supabase.js')});
  await p.evaluate(async({url,key,credentials})=>{
   window.scopeClient=window.supabase.createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
   window.scopeSignals=[];window.scopeChannels=[];
   if(credentials){const result=await window.scopeClient.auth.signInWithPassword(credentials);if(result.error)throw new Error('Synthetic scope login failed');}
  },{url:process.env.NEXT_PUBLIC_SUPABASE_URL!,key:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,credentials:credentials?{email:credentials.email,password:credentials.password}:undefined});
 }
 async function join(p:Page,t:string,event='queue_changed'){
  return p.evaluate(({t,event})=>new Promise<string>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Scope join did not finish')),15000);
   const channel=window.scopeClient.channel(t,{config:{private:true,broadcast:{ack:true,self:true}}}).on('broadcast',{event},({payload})=>window.scopeSignals.push(payload));
   window.scopeChannels.push(channel);channel.subscribe(status=>{if(status==='SUBSCRIBED'||status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);resolve(status);}});
  }),{t,event});
 }
 async function reset(p:Page){await p.evaluate(async()=>{await window.scopeClient.removeAllChannels();window.scopeChannels=[];window.scopeSignals=[];});}
 try{
  await client(pa,a);await client(pb,b);await client(pp);
  // The harness already migrated 0035. Reproduce the exact old predicate only on this owned database.
  await sql.unsafe(`alter policy "active operators can receive dashboard queue broadcasts" on realtime.messages using(extension='broadcast' and (select realtime.topic()) ~ '^dashboard:event:[0-9]+:queue$' and (select private.is_active_dashboard_operator()));`);
  expect(await join(pa,topic)).toBe('SUBSCRIBED');
  await expect.poll(async()=>{
   await sql`update song_requests set position=position where event_id=${eb.id}`;
   return pa.evaluate(()=>window.scopeSignals.length);
  }).toBeGreaterThan(0);
  const observed=await pa.evaluate(()=>window.scopeSignals.map(x=>Object.keys(x).sort()));
  // Realtime adds its own message id to the application's minimal payload.
  for(const keys of observed)expect(keys).toEqual(['changedAt','eventId','id','operation','revision','type']);
  evidence.before={crossOrganizationJoin:'SUBSCRIBED',observedPayloadKeys:observed[0],piiInPayload:false};
  expect(await join(pa,participants,'participants_changed')).toBe('CHANNEL_ERROR');
  // Policy DDL is not immediate revocation of already joined socket authorization.
  const priorSignals=await pa.evaluate(()=>window.scopeSignals.length);await sql.unsafe(fix);
  await expect.poll(async()=>{
   await sql`update song_requests set position=position where event_id=${eb.id}`;
   return pa.evaluate(()=>window.scopeSignals.length);
  }).toBeGreaterThan(priorSignals);
  evidence.cachedAuthorizationPersistsUntilRejoin=true;
  await Promise.all([reset(pa),reset(pb),reset(pp)]);
  expect(await join(pa,topic)).toBe('CHANNEL_ERROR');
  expect(await join(pb,topic)).toBe('SUBSCRIBED');
  expect(await join(pb,participants,'participants_changed')).toBe('SUBSCRIBED');
  expect(await join(pp,topic)).toBe('CHANNEL_ERROR');
  expect(await join(pp,`public:session:${b.publicToken}:queue`)).toBe('SUBSCRIBED');
  await expect.poll(async()=>{
   await sql`update song_requests set position=position where event_id=${eb.id}`;
   return pb.evaluate(()=>window.scopeSignals.length);
  }).toBeGreaterThan(0);
  await expect.poll(()=>pp.evaluate(()=>window.scopeSignals.length)).toBeGreaterThan(0);
  expect(await pa.evaluate(()=>window.scopeSignals.length)).toBe(0);
  const spoof=await pb.evaluate(()=>window.scopeChannels[0].send({type:'broadcast',event:'queue_changed',payload:{type:'forged'}}));
  expect(spoof).not.toBe('ok');
  const ownCount=await pb.evaluate(()=>window.scopeSignals.length);
  await sql`update song_requests set position=position where event_id=${eb.id}`;
  await expect.poll(()=>pb.evaluate(()=>window.scopeSignals.length)).toBeGreaterThan(ownCount);
  for(const p of [pb,pp])expect(await p.evaluate(()=>window.scopeSignals.some(x=>x.type==='forged'))).toBe(false);
  // Normal application sign-in supplies session cookies for the API denial check.
  await pa.waitForFunction(()=>{const e=document.querySelector('#operator-email');return e&&Object.keys(e).some(k=>k.startsWith('__reactProps'));});
  await pa.locator('#operator-email').fill(a.email);await pa.locator('#operator-password').fill(a.password);
  await pa.getByRole('button',{name:'Zaloguj się',exact:true}).click();await expect(pa).toHaveURL(/\/dashboard(?:\/|$)/);
  const denied=await pa.request.get(`/api/dashboard/organizations/${b.organizationPublicId}/events/${b.eventPublicId}/queue/sync?deviceId=00000000-0000-4000-8000-000000000001`);
  expect([403,404]).toContain(denied.status());
  evidence.after={crossOrganizationJoin:'CHANNEL_ERROR',anonymousDashboard:'CHANNEL_ERROR',ownQueue:'SUBSCRIBED',ownParticipants:'SUBSCRIBED',publicQueue:'SUBSCRIBED',crossOrganizationApi:denied.status(),forgedBroadcastResult:spoof,forgedPayloadObserved:false};
  writeFileSync('.artifacts/release-gate-realtime-browser.json',JSON.stringify(evidence,null,2)+'\n');
 }finally{
  evidence.lastObservedCounts=await Promise.all([pa,pb,pp].map(p=>p.evaluate(()=>window.scopeSignals?.length??0).catch(()=>-1)));
  const [emitted]=await sql`select count(*)::int n from realtime.messages where topic=${topic}`;
  evidence.retainedDashboardMessageCount=emitted.n;
  writeFileSync('.artifacts/release-gate-realtime-browser-attempt.json',JSON.stringify(evidence,null,2)+'\n');
  await sql.unsafe(fix);
  await Promise.all([ca.close(),cb.close(),anonymous.close()]);await sql.end({timeout:5});await a.cleanup();await b.cleanup();
 }
});
