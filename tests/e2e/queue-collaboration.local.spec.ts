import {expect,test,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {cpus,totalmem} from 'node:os';
import {createLocalSupabaseFixture,type LocalSupabaseFixture} from './local-supabase-fixture';

test.describe.configure({mode:'serial'});
let fixture:LocalSupabaseFixture;
const metrics:Array<Record<string,unknown>>=[];
test.beforeAll(async()=>{fixture=await createLocalSupabaseFixture();});
test.afterAll(async()=>{await fixture?.cleanup();if(metrics.length)writeFileSync('.artifacts/queue-collaboration-browser-metrics.json',JSON.stringify({capturedUtc:new Date().toISOString(),environment:{node:process.version,os:process.platform,cpu:cpus()[0]?.model,logicalCpus:cpus().length,memoryGiB:Math.round(totalmem()/2**30),build:process.env.LOCAL_E2E_OPTIMIZED==='1'?'optimized':'development',browser:'Playwright Chromium headless',physicalTouch:false},budgets:{localP95Ms:100,syncP95Ms:2000,syncMaxMs:5000},metrics},null,2));});
const path=()=>`/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`;
const lane=(p:Page)=>p.locator('[data-queue-lane="approved"]:visible');
const row=(p:Page,name:string)=>p.locator('[data-queue-request-id]:visible').filter({has:p.locator('strong',{hasText:new RegExp('^'+name+'$')})});
async function names(p:Page){return lane(p).locator('[data-queue-request-id] strong').allTextContents();}
async function canonical(){return (await fixture.readQueueRows()).filter(x=>x.status==='approved').sort((a,b)=>a.position-b.position).map(x=>x.displayName);}
async function login(p:Page,credentials:{email:string;password:string}=fixture){p.setDefaultTimeout(15000);await p.goto('/sign-in');await p.waitForFunction(()=>{const e=document.querySelector('#operator-email');return e&&Object.keys(e).some(k=>k.startsWith('__reactProps'));});await p.locator('#operator-email').fill(credentials.email);await p.locator('#operator-password').fill(credentials.password);await p.getByRole('button',{name:'Zaloguj się',exact:true}).click();await expect(p).toHaveURL(/\/dashboard(?:\/|$)/);await p.waitForLoadState('networkidle');await p.goto(path());await expect(p.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');await expect(p.locator('[data-realtime-status]:visible')).toHaveAttribute('data-realtime-status','live');}
async function pair(browser:Browser,peer?:{email:string;password:string}){const a=await browser.newContext({viewport:{width:1500,height:1100},locale:'pl-PL'}),b=await browser.newContext({viewport:{width:1500,height:1100},locale:'pl-PL'});const pa=await a.newPage(),pb=await b.newPage();await login(pa);await login(pb,peer);return {a,b,pa,pb,close:async()=>{await a.close();await b.close();}};}
async function keyboardDrop(p:Page,name:string,key:'End'|'Home'){
  const handle=row(p,name).getByRole('button',{name:/^Przeciągnij/});await handle.scrollIntoViewIfNeeded();await handle.focus();await handle.press('Space');await expect(p.locator('[data-queue-drag-overlay]')).toBeVisible();await p.evaluate(()=>new Promise(requestAnimationFrame));const position=key==='Home'?1:await lane(p).locator('[data-queue-request-id]').count();
  await p.keyboard.press(key);
  await expect(p.locator('[data-queue-insertion-indicator]')).toHaveAttribute('data-target-position',String(position));
  await p.keyboard.press('Space');await expect(p.locator('[data-queue-drag-overlay]')).toHaveCount(0);
  await expect.poll(async()=>(await names(p)).indexOf(name)+1).toBe(position);
}
async function measureClick(p:Page,name:string,direction:'górę'|'dół'){
  const r=row(p,name);await r.scrollIntoViewIfNeeded();const id=Number(await r.getAttribute('data-queue-request-id'));
  await p.evaluate(id=>{
    document.documentElement.dataset.queueLatency='';
    document.addEventListener('click',()=>{const start=performance.now(),before=[...document.querySelectorAll(`[data-queue-request-id="${id}"]`)].find(e=>e.checkVisibility())?.textContent;
      const frame=()=>{const after=[...document.querySelectorAll(`[data-queue-request-id="${id}"]`)].find(e=>e.checkVisibility())?.textContent;if(after!==before)document.documentElement.dataset.queueLatency=String(performance.now()-start);else if(performance.now()-start<3000)requestAnimationFrame(frame);};requestAnimationFrame(frame);
    },{capture:true,once:true});
  },id);
  await r.getByRole('button',{name:new RegExp('^Przesuń zgłoszenie w '+direction)}).click();
  await expect.poll(()=>p.evaluate(()=>document.documentElement.dataset.queueLatency)).not.toBe('');
  return p.evaluate(()=>Number(document.documentElement.dataset.queueLatency));
}

test.describe('Collaborative queue integration',()=>{
  test.setTimeout(180000);
  test('independent HTTP writes remain local immediately and reconcile Realtime from another same-account device',async({browser})=>{
    await fixture.seedDragQueue(8);const t=await pair(browser);let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});const devices=new Set<string>();
    try{
      t.pa.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/sync'))devices.add(r.postDataJSON().deviceId);});t.pb.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/sync'))devices.add(r.postDataJSON().deviceId);});
      await t.pa.route('**/queue/sync',async r=>{if(r.request().method()==='POST')await barrier;await r.continue();});
      await keyboardDrop(t.pa,'Drag 1','End');await expect(row(t.pa,'Drag 1')).toContainText('Pozycja: 8');
      await row(t.pa,'Drag Pending').getByRole('button',{name:/^Zaakceptuj:/}).click();
      await expect(row(t.pa,'Drag 4').getByRole('button',{name:/^Przeciągnij/})).toBeEnabled();
      await row(t.pb,'Drag 2').getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();
      await expect.poll(async()=> (await names(t.pa)).indexOf('Drag 3')<(await names(t.pa)).indexOf('Drag 2')).toBe(true);
      expect(await canonical()).not.toEqual(await names(t.pa));release();
      await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      await expect.poll(()=>names(t.pb)).toEqual(await canonical());await expect.poll(()=>names(t.pa)).toEqual(await canonical());expect(devices.size).toBe(2);
    }finally{release();await t.close();}
  });
  test('a duplicated authenticated tab cannot overwrite its opener outbox',async({browser})=>{
    await fixture.seedDragQueue();const context=await browser.newContext({viewport:{width:1500,height:1100},locale:'pl-PL'}),a=await context.newPage();
    let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
    try{await login(a);await a.route('**/queue/sync',async r=>{if(r.request().method()==='POST')await gate;await r.continue();});
      await keyboardDrop(a,'Drag 1','End');
      const opened=context.waitForEvent('page');await a.evaluate(url=>{window.open(url,'_blank');},path());const b=await opened;
      await expect(b.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      const key='kunestu-queue-device-v1';expect(await b.evaluate(key=>sessionStorage.getItem(key),key)).not.toBe(await a.evaluate(key=>sessionStorage.getItem(key),key));
      await row(b,'Drag 4').getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();await expect(b.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      await expect(row(a,'Drag 1')).toContainText('Pozycja: 6');release();
      await expect(a.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');await expect.poll(()=>names(b)).toEqual(await canonical());
    }finally{release();await context.close();}
  });
  test('rapid same-song DnD preserves every dependent intent before the first HTTP acknowledgement',async({browser})=>{
    await fixture.seedDragQueue();const t=await pair(browser);let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});const ids=new Set<string>();
    try{await t.pa.route('**/queue/sync',async r=>{if(r.request().method()==='POST'){ids.add(r.request().postDataJSON().operationId);await gate;}await r.continue();});
      await keyboardDrop(t.pa,'Drag 1','End');await keyboardDrop(t.pa,'Drag 1','Home');await keyboardDrop(t.pa,'Drag 1','End');
      expect((await names(t.pa)).at(-1)).toBe('Drag 1');expect((await canonical())[0]).toBe('Drag 1');
      release();await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      expect(ids.size).toBe(3);await expect.poll(()=>names(t.pb)).toEqual(await canonical());expect((await canonical()).at(-1)).toBe('Drag 1');
      await expect(t.pa.locator('[data-queue-conflict]:visible')).toHaveCount(0);
    }finally{release();await t.close();}
  });
  test('different authorised accounts converge and stale API snapshots cannot undo committed state',async({browser})=>{
    await fixture.seedDragQueue();const peer=await fixture.createPeerOperator(),t=await pair(browser,peer);const actors=new Set<number>();
    try{
      const capture=(p:Page)=>p.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/sync'))actors.add(r.postDataJSON().actorId);});capture(t.pa);capture(t.pb);
      const oldResponse=await t.pa.request.get(`/api/dashboard/organizations/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue/sync?deviceId=${crypto.randomUUID()}`);
      expect(oldResponse.status()).toBe(200);const old=await oldResponse.json();
      await row(t.pa,'Drag 1').getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();
      await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      await expect.poll(()=>names(t.pb)).toEqual(await canonical());
      await row(t.pb,'Drag 4').getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();
      await expect(t.pb.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      const fresh=await canonical();await expect.poll(()=>names(t.pa)).toEqual(fresh);
      let injected=0;await t.pa.route('**/queue/sync?**',async r=>{injected++;await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(old)});});
      await t.pa.getByRole('button',{name:'Odśwież',exact:true}).click();await expect.poll(()=>injected).toBeGreaterThan(0);
      expect(await names(t.pa)).toEqual(fresh);expect(actors.size).toBe(2);expect(actors.has(peer.operatorId)).toBe(true);
      await t.pa.unroute('**/queue/sync?**');
    }finally{await t.close();}
  });
  test('conflicting same-song movements retain the losing intent and never overwrite the winner',async({browser})=>{
    await fixture.seedDragQueue();const t=await pair(browser);let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
    try{await t.pa.route('**/queue/sync',async r=>{if(r.request().method()==='POST')await gate;await r.continue();});
      await keyboardDrop(t.pa,'Drag 1','End');await row(t.pb,'Drag 1').getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();await expect(t.pb.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      const winner=await canonical();release();await expect(t.pa.locator('[data-queue-conflict]:visible')).toBeVisible();expect(await canonical()).toEqual(winner);await expect.poll(()=>names(t.pa)).toEqual(winner);
      await t.pa.reload();await expect(t.pa.locator('[data-queue-conflict]:visible')).toBeVisible();expect(await canonical()).toEqual(winner);
    }finally{release();await t.close();}
  });
  test('offline outbox survives an unconfirmed write, page reload and reconnect',async({browser})=>{
    await fixture.seedDragQueue();const t=await pair(browser);
    try{await t.a.setOffline(true);await row(t.pa,'Drag 1').getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();await row(t.pa,'Drag 1').getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();
      await expect(row(t.pa,'Drag 1')).toContainText('Pozycja: 3');await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','offline');
      await t.pa.route('**/queue/sync',r=>r.request().method()==='POST'?r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE'}})}):r.continue());await t.a.setOffline(false);
      await expect(t.pa.getByRole('button',{name:'Ponów bezpiecznie'})).toBeVisible();t.pa.once('dialog',dialog=>dialog.accept());await t.pa.reload();await expect(row(t.pa,'Drag 1')).toContainText('Pozycja: 3');
      await t.pa.unroute('**/queue/sync');await t.pa.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      await expect.poll(()=>names(t.pb)).toEqual(['Drag 2','Drag 3','Drag 1','Drag 4','Drag 5','Drag 6']);
    }finally{await t.a.setOffline(false);await t.close();}
  });
  test('a committed write with a lost HTTP response is recovered from its receipt without applying twice',async({browser})=>{
    await fixture.seedDragQueue();const t=await pair(browser);let expectedVersion=-1,requestId=0;const ids=new Set<string>();
    try{await t.pa.route('**/queue/sync',async route=>{
      if(route.request().method()!=='POST'){await route.continue();return;}
      const operation=route.request().postDataJSON();ids.add(operation.operationId);expectedVersion=operation.expectedIntentVersion;requestId=operation.requestId;
      const committed=await route.fetch();expect(committed.status()).toBe(200);await route.abort('connectionreset');
    });
      await row(t.pa,'Drag 1').getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();
      await expect.poll(()=>names(t.pb)).toEqual(['Drag 2','Drag 1','Drag 3','Drag 4','Drag 5','Drag 6']);
      await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      expect(ids.size).toBe(1);const device=await t.pa.evaluate(()=>sessionStorage.getItem('kunestu-queue-device-v1'));
      const response=await t.pa.request.get(`/api/dashboard/organizations/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue/sync?deviceId=${device}`);expect(response.status()).toBe(200);
      expect((await response.json()).items.find((r:{id:number})=>r.id===requestId).intentVersion).toBe(expectedVersion+1);
      await expect(t.pa.locator('[data-queue-conflict]:visible')).toHaveCount(0);
    }finally{await t.close();}
  });
  test('start/start has one winner and fresh done reaches both operators',async({browser})=>{
    await fixture.seedDragQueue();const t=await pair(browser);let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
    const hold=async(c:BrowserContext)=>c.route('**/queue/sync',async r=>{if(r.request().method()==='POST')await gate;await r.continue();});
    try{await hold(t.a);await hold(t.b);await row(t.pa,'Drag 1').getByRole('button',{name:/^Rozpocznij występ:/}).click();await row(t.pb,'Drag 2').getByRole('button',{name:/^Rozpocznij występ:/}).click();release();
      await expect.poll(async()=>t.pa.locator('[data-queue-conflict]:visible').count().then(async a=>a+await t.pb.locator('[data-queue-conflict]:visible').count())).toBe(1);
      const rows=await fixture.readQueueRows();expect(rows.filter(x=>x.status==='now')).toHaveLength(1);expect(rows.filter(x=>x.status==='done').map(x=>x.displayName)).toEqual(['Drag Now']);
      const winner=rows.find(x=>x.status==='now')!;const winnerPage=await t.pa.locator('[data-queue-conflict]:visible').count()?t.pb:t.pa;
      await row(winnerPage,winner.displayName).getByRole('button',{name:/^Oznacz jako zagrane:/}).click();await expect.poll(async()=>(await fixture.readQueueRows()).filter(x=>x.status==='now').length).toBe(0);
      for(const p of [t.pa,t.pb])await expect(p.getByText('Żadne zgłoszenie nie jest teraz oznaczone jako śpiewane.')).toBeVisible();
    }finally{release();await t.close();}
  });
  test('remote movement and Fair Sort safely cancel an active keyboard gesture',async({browser})=>{
    await fixture.seedDragQueue();const t=await pair(browser);let posts=0;t.pa.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/sync'))posts++;});
    async function lift(){const h=row(t.pa,'Drag 1').getByRole('button',{name:/^Przeciągnij/});await h.scrollIntoViewIfNeeded();await h.focus();await h.press('Space');await expect(t.pa.locator('[data-queue-drag-overlay]')).toBeVisible();}
    try{await lift();await row(t.pb,'Drag 4').getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();await expect(t.pa.locator('[data-queue-drag-overlay]')).toHaveCount(0);await t.pa.keyboard.press('Escape');expect(posts).toBe(0);
      await lift();await t.pb.getByRole('button',{name:'Ułóż sprawiedliwie',exact:true}).click();await t.pb.getByRole('button',{name:'Zastosuj kolejność',exact:true}).click();await expect(t.pa.locator('[data-queue-drag-overlay]')).toHaveCount(0);await t.pa.keyboard.press('Escape');expect(posts).toBe(0);
      await expect.poll(()=>names(t.pa)).toEqual(await canonical());
    }finally{await t.close();}
  });
  test('Integrated nickname, immutable identity, Fair Queue, cancel and two-operator DnD share one canonical event',async({browser})=>{
    await fixture.seedDragQueue();const peer=await fixture.createPeerOperator(),t=await pair(browser,peer);
    const phoneContext=await browser.newContext({viewport:{width:390,height:844},locale:'pl-PL'}),phone=await phoneContext.newPage();
    let releasePending=()=>{};
    try{
      await phone.goto(`/join/${fixture.sessionCode}`);await phone.getByLabel('Imię lub ksywka').fill('Dimon');await phone.getByRole('button',{name:'Dołącz',exact:true}).click();
      await expect(phone.getByRole('button',{name:'Zmień swój nick'})).toBeVisible();
      await phone.getByRole('searchbox').fill('E2E Song');await expect(phone.getByRole('heading',{name:'„E2E Song”'})).toBeVisible();
      await phone.getByRole('button',{name:/E2E Song/}).click();await phone.getByRole('button',{name:'Dodaj do kolejki'}).click();
      await expect(row(t.pa,'Dimon')).toBeVisible();await expect(row(t.pb,'Dimon')).toBeVisible();
      await row(t.pa,'Dimon').getByRole('button',{name:/^Zaakceptuj:/}).click();await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      const initial=(await fixture.readParticipantRequests('Dimon'))[0];expect(initial).toBeDefined();
      const handle=row(t.pa,'Drag 1').getByRole('button',{name:/^Przeciągnij/});await handle.scrollIntoViewIfNeeded();await handle.focus();await handle.press('Space');await expect(t.pa.locator('[data-queue-drag-overlay]')).toBeVisible();
      async function rename(name:string){await phone.getByRole('button',{name:'Zmień swój nick'}).click();await phone.getByLabel('Twój nick').fill(name);await phone.getByRole('button',{name:'Zapisz',exact:true}).click();await expect(phone.getByRole('button',{name:'Zmień swój nick'})).toBeVisible();}
      // Observe commit acknowledgement separately from opening/filling the phone dialog.
      const renameCommitted=phone.waitForResponse(r=>r.request().method()==='PATCH'&&/\/api\/s\/[^/]+\/participant$/.test(new URL(r.url()).pathname));
      const started=performance.now();const renaming=rename('Dima');const acknowledgement=await renameCommitted;expect(acknowledgement.status()).toBe(200);const committed=performance.now();
      await expect.poll(async()=>await row(t.pa,'Dima').count()===1&&await row(t.pb,'Dima').count()===1,{intervals:[10,25,50,100]}).toBe(true);
      const propagationMs=performance.now()-committed;metrics.push({scenario:'nickname-rename',fullFormMs:performance.now()-started,acknowledgementToBothOperatorsMs:propagationMs});expect(propagationMs).toBeLessThan(5000);await renaming;
      await expect(t.pa.locator('[data-queue-drag-overlay]')).toBeVisible();await t.pa.keyboard.press('End');await t.pa.keyboard.press('Space');await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      await expect(row(t.pb,'Dima')).toContainText('Zgłoszono jako: Dimon');
      await row(t.pa,'Dima').getByRole('button',{name:/^Rozpocznij występ:/}).click();await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      await rename('Dima Stage');await expect(row(t.pb,'Dima Stage')).toBeVisible();
      await row(t.pa,'Dima Stage').getByRole('button',{name:/^Anuluj występ:/}).click();await expect(t.pa.getByRole('alertdialog')).toBeVisible();await t.pa.getByRole('button',{name:'Anuluj',exact:true}).click();
      await row(t.pa,'Dima Stage').getByRole('button',{name:/^Anuluj występ:/}).click();await t.pa.getByRole('alertdialog').getByRole('button',{name:/^Anuluj występ:/}).click();
      await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      await expect(row(t.pa,'Dima Stage')).toContainText('Pierwszy występ');
      await row(t.pa,'Dima Stage').getByRole('button',{name:/^Rozpocznij występ:/}).click();await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      await row(t.pa,'Dima Stage').getByRole('button',{name:/^Oznacz jako zagrane:/}).click();await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      await rename('Dima Final');for(const p of [t.pa,t.pb])await expect(row(p,'Dima Final')).toContainText('Zakończone występy: 1');
      const final=(await fixture.readParticipantRequests('Dima Final'))[0];expect(final.eventParticipantId).toBe(initial.eventParticipantId);expect(final.requestDisplayName).toBe('Dimon');
      const pending=new Promise<void>(resolve=>{releasePending=resolve;});
      await t.pa.route('**/queue/sync',async route=>{if(route.request().method()==='POST')await pending;await route.continue();});
      await keyboardDrop(t.pa,'Drag 2','End');await rename('Dima Synced');for(const p of [t.pa,t.pb])await expect(row(p,'Dima Synced')).toContainText('Zakończone występy: 1');
      expect((await names(t.pa)).at(-1)).toBe('Drag 2');releasePending();await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');await t.pa.unroute('**/queue/sync');
      await t.pa.getByRole('button',{name:'Ułóż sprawiedliwie',exact:true}).click();if(process.env.KUNESTU_FAIR_QUEUE_ENGINE==='rotation-v2')await expect(t.pa.getByRole('dialog')).toContainText('Szczegóły decyzji');await t.pa.getByRole('button',{name:'Zastosuj kolejność',exact:true}).click();await expect.poll(()=>names(t.pb)).toEqual(await canonical());
    }finally{releasePending();await phoneContext.close();await t.close();}
  });
  for(const count of [20,50,100])test(`performance ${count}: native local render frame and committed cross-browser convergence`,async({browser})=>{
    await fixture.seedDragQueue(count);const t=await pair(browser);const local:number[]=[],sync:number[]=[],acknowledgements:number[]=[];
    const samples=Number(process.env.LOCAL_E2E_PERFORMANCE_SAMPLES??10);expect([10,30,100]).toContain(samples);
    const profiling=process.env.LOCAL_E2E_P0_PROFILE==='1',label=process.env.LOCAL_E2E_PROFILE_LABEL??'candidate';expect(['fa9-baseline','candidate']).toContain(label);
    const cdp=profiling?await t.a.newCDPSession(t.pa):null;
    const work:unknown[]=[];
    if(cdp){await cdp.send('Profiler.enable');await cdp.send('Performance.enable');await cdp.send('Profiler.start');}
    try{for(let i=0;i<samples;i++){
      const before=cdp?await cdp.send('Performance.getMetrics'):null;
      if(cdp)await t.pa.evaluate(()=>performance.clearMarks());
      const start=performance.now();
      const committed=t.pa.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/queue/sync')&&r.status()===200).then(async response=>({ms:performance.now()-start,trace:(await response.json()).trace as {operationId:string;requestId:string;revision:string}|null}));
      const [frame,ack]=await Promise.all([measureClick(t.pa,'Drag 1',i%2?'górę':'dół'),committed]);local.push(frame);acknowledgements.push(ack.ms);
      await expect.poll(()=>names(t.pb),{intervals:[10,25,50,100]}).toEqual(await names(t.pa));sync.push(performance.now()-start);
      await expect(t.pa.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
      if(!profiling){
        expect(ack.trace).toBeTruthy();
        await expect.poll(()=>t.pb.evaluate(trace=>window.kunestuQueueDiagnostics?.report().some(record=>record.stage==='rendered'&&record.operationId===trace?.operationId&&record.requestId===trace?.requestId&&record.revision===trace?.revision&&!record.pending)??false,ack.trace),{intervals:[10,25,50]}).toBe(true);
      }
      if(cdp&&before){const after=await cdp.send('Performance.getMetrics');const marks=await t.pa.evaluate(()=>performance.getEntriesByType('mark').filter(x=>x.name.startsWith('p0:')).map(x=>x.name));
        work.push({marks:marks.reduce<Record<string,number>>((out,name)=>{out[name]=(out[name]??0)+1;return out;},{}),durationsMs:Object.fromEntries(['ScriptDuration','LayoutDuration','RecalcStyleDuration','TaskDuration'].map(name=>[name,1000*((after.metrics.find(x=>x.name===name)?.value??0)-(before.metrics.find(x=>x.name===name)?.value??0))]))});}
    }
    const percentile=(values:number[],p=.95)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];const m={count,samples,profiling,localMs:local,syncMs:sync,acknowledgementMs:acknowledgements,acknowledgementP95Ms:percentile(acknowledgements),localP95Ms:percentile(local),syncP95Ms:percentile(sync),syncMaxMs:Math.max(...sync),diagnosticPeerReceiptsVerified:!profiling,percentiles:{local:[.5,.95,.99].map(p=>percentile(local,p)),http:[.5,.95,.99].map(p=>percentile(acknowledgements,p)),peer:[.5,.95,.99].map(p=>percentile(sync,p))}};metrics.push(m);
    if(cdp){const {profile}=await cdp.send('Profiler.stop');writeFileSync(`.artifacts/p0-final-mile-profile-${label}-${count}.json`,JSON.stringify({utc:new Date().toISOString(),count,samples,work,profile,metrics:m}));}
    expect(m.acknowledgementP95Ms).toBeLessThan(2000);expect(m.localP95Ms).toBeLessThanOrEqual(100);expect(m.syncP95Ms).toBeLessThan(2000);expect(m.syncMaxMs).toBeLessThanOrEqual(5000);
    }finally{await t.close();}
  });
});
