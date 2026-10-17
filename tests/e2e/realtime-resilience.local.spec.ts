import { expect, test, type Browser, type Page, type WebSocketRoute } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { createLocalSupabaseFixture, type LocalSupabaseFixture } from './local-supabase-fixture';

test.describe.configure({mode:'serial'});
let fixture: LocalSupabaseFixture;
const metrics: Record<string,unknown>[] = [];
test.beforeAll(async()=>{fixture=await createLocalSupabaseFixture();});
test.afterAll(async()=>{try{await fixture?.cleanup();}finally{writeFileSync('.artifacts/realtime-resilience-metrics.json',JSON.stringify({utc:new Date().toISOString(),browser:'Chromium headless',node:process.version,os:process.platform,cpu:cpus()[0]?.model,memoryGiB:Math.round(totalmem()/2**30),optimized:process.env.LOCAL_E2E_OPTIMIZED==='1',physicalWindowsDesktops:false,metrics},null,2));}});
const path=()=>`/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`;
const status=(p:Page)=>p.locator('[data-realtime-status]:visible');
const row=(p:Page,name:string)=>p.locator('[data-queue-request-id]:visible').filter({has:p.locator('strong',{hasText:new RegExp('^'+name+'$')})});
const names=(p:Page)=>p.locator('[data-queue-lane="approved"]:visible [data-queue-request-id] strong').allTextContents();
const canonical=async()=>(await fixture.readQueueRows()).filter(x=>x.status==='approved').sort((a,b)=>a.position-b.position).map(x=>x.displayName);
async function synced(p:Page){await expect(p.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');}
async function login(p:Page,credentials:{email:string;password:string}=fixture){
  await p.goto('/sign-in');await p.waitForFunction(()=>{const e=document.querySelector('#operator-email');return e&&Object.keys(e).some(k=>k.startsWith('__reactProps'));});
  await p.locator('#operator-email').fill(credentials.email);await p.locator('#operator-password').fill(credentials.password);
  await p.getByRole('button',{name:'Zaloguj się',exact:true}).click();await expect(p).toHaveURL(/\/dashboard(?:\/|$)/);await p.waitForLoadState('networkidle');
  await p.goto(path());await synced(p);
  await p.evaluate(()=>window.kunestuRealtimeDiagnostics?.enable());
  await expect(status(p)).toHaveAttribute('data-realtime-status','live');
}
async function pair(browser:Browser,peer?:{email:string;password:string}){
  const a=await browser.newContext({viewport:{width:1500,height:1100}}),b=await browser.newContext({viewport:{width:1500,height:1100}});
  const pa=await a.newPage(),pb=await b.newPage();await login(pa);await login(pb,peer);
  return {a,b,pa,pb,close:async()=>{await a.close();await b.close();}};
}

test('Resilience: same-account documents recover missed broadcasts after offline and CDP freeze without F5',async({browser})=>{
  test.setTimeout(210000);
  const frozenMs=process.env.LOCAL_E2E_SHORT_JWT==='1'?130000:70000;
  await fixture.seedDragQueue();const t=await pair(browser);const cdp=await t.a.newCDPSession(t.pa);let sockets=0,gets=0,lostBroadcasts=0,blockBroadcasts=false;
  await t.a.routeWebSocket('**/realtime/v1/websocket**',ws=>{
    const server=ws.connectToServer();server.onMessage(data=>{
      if(blockBroadcasts){
        // Installed SDK 2.110 Serializer.KINDS.userBroadcast = 4: Supabase
        // delivers JSON queue payloads inside binary v2 broadcast envelopes.
        // Inspect only the frame kind, never retain/log its private payload.
        const frame=typeof data==='string'?JSON.parse(data):null;
        const broadcast=typeof data==='string'?(Array.isArray(frame)?frame[3]:frame.event)==='broadcast':data.length>0&&data[0]===4;
        if(broadcast){lostBroadcasts++;return;}
      }
      ws.send(data);
    });
  });
  await t.pa.reload();await synced(t.pa);await expect(status(t.pa)).toHaveAttribute('data-realtime-status','live');
  await t.pa.evaluate(()=>window.kunestuRealtimeDiagnostics?.enable());
  t.pa.on('websocket',()=>sockets++);t.pa.on('request',r=>{if(r.method()==='GET'&&r.url().includes('/queue/sync?'))gets++;});
  try{
    await t.pa.waitForLoadState('networkidle');
    blockBroadcasts=true;
    await row(t.pb,'Drag 4').getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();await synced(t.pb);
    // Prove an actual Broadcast was discarded before offline closes the upstream.
    await expect.poll(()=>lostBroadcasts).toBeGreaterThan(0);
    expect(await names(t.pa)).not.toEqual(await canonical());
    await t.a.setOffline(true);await expect(status(t.pa)).not.toHaveAttribute('data-realtime-status','live');
    await cdp.send('Page.setWebLifecycleState',{state:'frozen'});
    await row(t.pb,'Drag 2').getByRole('button',{name:/^Rozpocznij występ:/}).click();await synced(t.pb);
    await row(t.pb,'Drag 2').getByRole('button',{name:/^Oznacz jako zagrane:/}).click();await synced(t.pb);
    await t.pb.getByRole('button',{name:'Ułóż sprawiedliwie',exact:true}).click();await t.pb.getByRole('button',{name:'Zastosuj kolejność',exact:true}).click();
    await expect(t.pb.getByRole('dialog')).toHaveCount(0);
    // Span the stale-heartbeat/task-gap threshold with real suspended JS time.
    await t.pb.waitForTimeout(frozenMs);expect(lostBroadcasts).toBeGreaterThan(0);
    const before=await canonical();const start=performance.now();blockBroadcasts=false;await t.a.setOffline(false);
    await cdp.send('Page.setWebLifecycleState',{state:'active'});await t.pa.bringToFront();
    await expect(status(t.pa)).toHaveAttribute('data-realtime-status','live',{timeout:20000});await expect.poll(()=>names(t.pa)).toEqual(before);await synced(t.pa);
    const elapsed=performance.now()-start;expect(elapsed).toBeLessThan(20000);expect(sockets).toBeLessThanOrEqual(3);expect(gets).toBeLessThanOrEqual(8);
    metrics.push({scenario:'offline-freeze-missed-broadcast',recoveryMs:elapsed,newSockets:sockets,snapshotGets:gets,lostBroadcasts,frozenMs,expiredJwtWhileFrozen:process.env.LOCAL_E2E_SHORT_JWT==='1',diagnostics:await t.pa.evaluate(()=>window.kunestuRealtimeDiagnostics?.report())});
  }finally{await cdp.send('Page.setWebLifecycleState',{state:'active'});await t.a.setOffline(false);await t.close();}
});

test('Resilience: two same-account tabs sustain heartbeats and real token renewal without queue polling',async({browser})=>{
  test.setTimeout(180000);await fixture.seedDragQueue();
  const context=await browser.newContext({viewport:{width:1500,height:1100}}),a=await context.newPage(),b=await context.newPage();
  let renewals=0,sockets=0,gets=0;const heartbeatReplies=[0,0];
  try{
    for(const [index,page] of [a,b].entries()){
      page.on('websocket',ws=>{sockets++;ws.on('framereceived',event=>{
        if(typeof event.payload==='string'){try{const frame=JSON.parse(event.payload);if(Array.isArray(frame)&&frame[2]==='phoenix'&&frame[3]==='phx_reply')heartbeatReplies[index]++;}catch{/* Ignore non-JSON protocol frames. */}}
      });});
      page.on('response',response=>{if(response.url().includes('/auth/v1/token?grant_type=refresh_token')&&response.status()===200)renewals++;});
    }
    await login(a);await b.goto(path());await synced(b);await expect(status(b)).toHaveAttribute('data-realtime-status','live');
    await b.evaluate(()=>window.kunestuRealtimeDiagnostics?.enable());
    await a.evaluate(()=>window.kunestuRealtimeDiagnostics?.enable());
    const client=await context.newCDPSession(a);await client.send('Emulation.setCPUThrottlingRate',{rate:4});
    const initialSockets=sockets,started=performance.now();
    const visibility=await Promise.all([a,b].map(p=>p.evaluate(()=>document.visibilityState)));
    for(const page of [a,b])page.on('request',r=>{if(r.method()==='GET'&&r.url().includes('/queue/sync?'))gets++;});
    await expect.poll(()=>heartbeatReplies[0],{timeout:110000}).toBeGreaterThanOrEqual(3);
    await expect.poll(()=>heartbeatReplies[1],{timeout:45000}).toBeGreaterThanOrEqual(3);
    if(process.env.LOCAL_E2E_SHORT_JWT==='1')await expect.poll(()=>renewals,{timeout:45000}).toBeGreaterThan(0);
    for(const page of [a,b])await expect(status(page)).toHaveAttribute('data-realtime-status','live');
    expect(sockets-initialSockets).toBe(0);expect(gets).toBe(0);
    await client.send('Emulation.setCPUThrottlingRate',{rate:1});
    const resumed=performance.now();await a.bringToFront();
    await row(b,'Drag 4').getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();await synced(b);await expect.poll(()=>names(a)).toEqual(await canonical());
    metrics.push({scenario:'two-tabs-steady-state',durationMs:performance.now()-started,newSockets:sockets-initialSockets,idleSnapshotGets:0,heartbeatReplies,renewals,shortJwt:process.env.LOCAL_E2E_SHORT_JWT==='1',cpuThrottle:4,visibility,postResumeConvergenceMs:performance.now()-resumed,browserVersion:browser.version(),diagnostics:await Promise.all([a,b].map(p=>p.evaluate(()=>window.kunestuRealtimeDiagnostics?.report())))});
  }finally{await context.close();}
});

test('Resilience: distinct accounts retain a held outbox intent and cancel a stale gesture across a real socket close',async({browser})=>{
  await fixture.seedDragQueue();const peer=await fixture.createPeerOperator(),t=await pair(browser,peer);
  let socket:WebSocketRoute|undefined,sockets=0,release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let held=false;
  // Proxy actual SDK traffic; only this owned browser's transport is interrupted.
  await t.a.routeWebSocket('**/realtime/v1/websocket**',ws=>{sockets++;socket=ws;ws.connectToServer();});
  try{
    await t.pa.reload();await synced(t.pa);await expect(status(t.pa)).toHaveAttribute('data-realtime-status','live');
    await t.pa.route('**/queue/sync',async route=>{if(route.request().method()==='POST'){held=true;await gate;}await route.continue();});
    await row(t.pa,'Drag 1').getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();await expect.poll(()=>held).toBe(true);
    expect((await names(t.pa))[1]).toBe('Drag 1');expect((await canonical())[0]).toBe('Drag 1');
    const handle=row(t.pa,'Drag 6').getByRole('button',{name:/^Przeciągnij/});await handle.focus();await handle.press('Space');await expect(t.pa.locator('[data-queue-drag-overlay]')).toBeVisible();
    const beforeFaultSockets=sockets,faultAt=performance.now();
    await socket?.close({code:1012,reason:'isolated recovery test'});
    await row(t.pb,'Drag 4').getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();await synced(t.pb);
    await expect(status(t.pa)).toHaveAttribute('data-realtime-status','live',{timeout:20000});
    await expect(t.pa.locator('[data-queue-drag-overlay]')).toHaveCount(0);
    // The independent local move remains projected while the POST is still held.
    expect((await names(t.pa))[1]).toBe('Drag 1');release();await synced(t.pa);await expect.poll(()=>names(t.pb)).toEqual(await canonical());
    expect((await canonical())[1]).toBe('Drag 1');expect(sockets).toBeLessThanOrEqual(3);
    metrics.push({scenario:'socket-close-outbox-drag',recoveryAndCommitMs:performance.now()-faultAt,newSockets:sockets-beforeFaultSockets});
  }finally{release();await t.close();}
});

test('Resilience: real SDK heartbeat timeout, CSP-blocked worker, recovery and focus storm stay bounded',async({browser})=>{
  test.setTimeout(150000);await fixture.seedDragQueue();const context=await browser.newContext({viewport:{width:1500,height:1100}});
  // route.fulfill() changes Chromium's address-space classification; permit
  // only this disposable localhost origin to reach the owned loopback socket.
  await context.grantPermissions(['local-network-access'],{origin:'http://localhost:3105'});
  let drop=true,sockets=0,heartbeats=0,gets=0,firstDroppedAt=0;const frameKinds:Record<string,number>={};
  const count=(key:string)=>{frameKinds[key]=(frameKinds[key]??0)+1;};
  await context.route('**/dashboard/**',async route=>{
    if (route.request().resourceType() !== 'document') { await route.continue(); return; }
    const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'content-security-policy':"worker-src 'none'"}});
  });
  await context.routeWebSocket('**/realtime/v1/websocket**',ws=>{
    sockets++;const server=ws.connectToServer();
    server.onClose((code)=>{count('server-close-'+String(code));void ws.close({code:code===1006?1011:code,reason:'isolated upstream close'});});
    ws.onMessage(data=>{count(typeof data==='string'?'client-text':'client-binary');server.send(data);});
    server.onMessage(data=>{
      count(typeof data==='string'?'server-text':'server-binary');
      let heartbeat=false;
      if(typeof data==='string'){try{const frame=JSON.parse(data);count(Array.isArray(frame)?'array-frame':'object-frame');heartbeat=Array.isArray(frame)?frame[2]==='phoenix'&&frame[3]==='phx_reply':frame.topic==='phoenix'&&frame.event==='phx_reply';}catch{/* Binary/non-JSON traffic is forwarded unchanged. */}}
      if(heartbeat&&drop){heartbeats++;firstDroppedAt ||= performance.now();return;}ws.send(data);
    });
  });
  const page=await context.newPage();
  try{
    await login(page);const initialSockets=sockets;page.on('request',r=>{if(r.method()==='GET'&&r.url().includes('/queue/sync?'))gets++;});
    await expect.poll(()=>heartbeats,{timeout:75000}).toBeGreaterThan(0);
    await expect.poll(()=>sockets,{timeout:75000}).toBeGreaterThan(initialSockets);drop=false;
    const start=performance.now();await expect(status(page)).toHaveAttribute('data-realtime-status','live',{timeout:20000});await synced(page);
    const recoveredAt=performance.now();
    const before=gets,beforeSubscriptions=await page.evaluate(()=>window.kunestuRealtimeDiagnostics?.report().counters.subscriptions);
    await page.evaluate(()=>{for(let i=0;i<100;i++){window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));}});
    // Observe beyond the initial retry delay; an immediate <= assertion can miss
    // a needless reconnect scheduled by the very first focus event.
    await page.waitForTimeout(3000);
    await expect(status(page)).toHaveAttribute('data-realtime-status','live');
    expect(gets-before).toBeLessThanOrEqual(2);expect(sockets).toBeLessThanOrEqual(initialSockets+3);
    const diagnostics=await page.evaluate(()=>window.kunestuRealtimeDiagnostics?.report());
    expect(diagnostics?.counters.subscriptions).toBe(beforeSubscriptions);
    expect(diagnostics?.counters.workerFallbacks).toBeGreaterThan(0);
    metrics.push({scenario:'heartbeat-timeout-worker-csp',recoveryAfterUnblockMs:recoveredAt-start,firstDroppedReplyToLiveMs:recoveredAt-firstDroppedAt,focusObservationMs:3000,newSockets:sockets-initialSockets,droppedHeartbeatReplies:heartbeats,focusSnapshotDelta:gets-before,diagnostics:await page.evaluate(()=>window.kunestuRealtimeDiagnostics?.report())});
  }finally{
    metrics.push({scenario:'heartbeat-final-state',sockets,heartbeats,frameKinds,diagnostics:await page.evaluate(()=>window.kunestuRealtimeDiagnostics?.report()).catch(()=>null)});
    await context.close();
  }
});
