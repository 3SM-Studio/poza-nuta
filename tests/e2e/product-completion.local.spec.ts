import {test,expect,type Page} from '@playwright/test';
import {createLocalSupabaseFixture} from './local-supabase-fixture';
import {recoveryCopy} from '../../src/i18n/recovery-copy';
import type {Locale} from '../../src/i18n/locale';
import postgres from 'postgres';
import {assertLocalDatabaseTarget} from '../../src/lib/local-target';
import {createClient} from '@supabase/supabase-js';
import {randomBytes,randomUUID} from 'node:crypto';
for(const locale of ['pl','en','uk'] as Locale[])test(`Product completion: ${locale} 404, root failure, segment retry and offline`,async({browser})=>{
 test.skip(process.env.LOCAL_E2E_RECOVERY_FIXTURES!=='1','Run through the source-restoring isolated fixture wrapper');
 const context=await browser.newContext({locale:locale==='uk'?'uk-UA':locale==='pl'?'pl-PL':'en-US',viewport:{width:locale==='pl'?1440:390,height:900},hasTouch:locale==='uk',isMobile:locale==='uk'}),page=await context.newPage();
 try{
  const missing=await page.goto('/unknown-recovery-path');expect(missing?.status()).toBe(404);await expect(page.locator('[data-recovery-kind="not_found"]')).toBeVisible();
  await expect(page.getByRole('heading',{level:1})).toHaveText(recoveryCopy[locale].states.not_found.title);
  await expect(page.getByRole('button',{name:recoveryCopy[locale].retry})).toHaveCount(0);
  await context.setExtraHTTPHeaders({'x-kunestu-test-segment-error':'1'});await page.goto('/dev/recovery-fixture');
  await expect(page.locator('[data-recovery-kind="unexpected"]')).toBeVisible();expect(await page.locator('body').innerText()).not.toContain('synthetic-recovery-sentinel');
  await context.setExtraHTTPHeaders({});await page.getByRole('button',{name:recoveryCopy[locale].retry}).click();await expect(page.getByRole('heading',{name:'Recovery fixture restored'})).toBeVisible();
  await context.setExtraHTTPHeaders({'x-kunestu-test-root-error':'1'});await page.goto('/join');
  await expect(page.locator('[data-recovery-kind="unexpected"]')).toBeVisible();await expect(page.locator('html')).toHaveAttribute('lang',locale);
  expect(await page.locator('body').innerText()).not.toContain('synthetic-recovery-sentinel');
  await page.screenshot({path:`.artifacts/product-recovery-error-${locale}.png`,fullPage:true});
  if(locale==='uk'){await page.setViewportSize({width:834,height:1194});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.artifacts/product-recovery-error-tablet.png',fullPage:true});await page.setViewportSize({width:390,height:900});}
  await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>{document.documentElement.style.fontSize='';});
  const before=page.url();await page.getByRole('combobox').selectOption('uk');await expect(page.locator('html')).toHaveAttribute('lang','uk');expect(page.url()).toBe(before);
  await page.getByRole('combobox').selectOption(locale);await context.setExtraHTTPHeaders({});await page.getByRole('button',{name:recoveryCopy[locale].retry}).click();await expect(page.locator('#session-code')).toBeVisible();
  await page.reload();await expect(page.locator('html')).toHaveAttribute('lang',locale);
  await context.setOffline(true);await expect(page.locator('[data-offline-notice]')).toBeVisible();await context.setOffline(false);await expect(page.locator('[data-offline-notice]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`.artifacts/product-completion-${locale}.png`,fullPage:true});
 }finally{await context.setOffline(false);await context.close();}
});

async function login(page:Page,f:{email:string;password:string;organizationPublicId:string;eventPublicId:string}){await page.goto('/sign-in');await page.locator('#operator-email').fill(f.email);await page.locator('#operator-password').fill(f.password);await page.getByRole('button',{name:'Zaloguj się',exact:true}).click();await expect(page).toHaveURL(/\/dashboard/);await page.waitForLoadState('networkidle');await page.goto(`/dashboard/org/${f.organizationPublicId}/events/${f.eventPublicId}/queue`);await expect(page.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');}
test('Product completion: 401 outbox survives reload and same-account recovery; v2 is the new-event default',async({browser})=>{
 const f=await createLocalSupabaseFixture(),context=await browser.newContext({locale:'pl-PL',viewport:{width:1440,height:1100}}),page=await context.newPage();
 try{await f.seedDragQueue();await login(page,f);const ids:string[]=[];
  await page.route('**/queue/sync',async r=>{if(r.request().method()==='POST'){ids.push(r.request().postDataJSON().operationId);await r.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'UNAUTHORIZED'}})});}else await r.continue();});
  await page.locator('[data-queue-lane="approved"]:visible [data-queue-request-id]').first().getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();await expect(page.locator('[data-queue-conflict]')).toBeVisible();
  // Emulate an already persisted pre-upgrade entry; do not touch its intent/ID.
  const migrated=await page.evaluate(()=>new Promise<number>((resolve,reject)=>{const r=indexedDB.open('kunestu-queue-outbox-v1',1);r.onerror=()=>reject(new Error('Test outbox unavailable'));r.onsuccess=()=>{const db=r.result,tx=db.transaction('outbox','readwrite'),store=tx.objectStore('outbox');let count=0;const cursor=store.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;const value=c.value;for(const e of value)if(e.phase==='conflict'){delete e.errorStatus;count++;}c.update(value);c.continue();};tx.oncomplete=()=>{db.close();resolve(count);};tx.onerror=()=>{db.close();reject(new Error('Legacy fixture update failed'));};};}));expect(migrated).toBe(1);
  await page.reload();const conflict=page.locator('[data-queue-conflict]');await expect(conflict).toBeVisible();await expect(conflict.getByRole('link',{name:'Zaloguj się'})).toHaveAttribute('target','_blank');
  await page.unroute('**/queue/sync');page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/sync'))ids.push(r.postDataJSON().operationId);});
  await conflict.getByRole('button',{name:'Spróbuj ponownie',exact:true}).click();await expect(page.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');expect(ids.length).toBeGreaterThanOrEqual(2);expect(new Set(ids).size).toBe(1);
  const response=await page.request.post(`/api/dashboard/organizations/${f.organizationPublicId}/events/${f.eventPublicId}/queue/fair`,{headers:{Origin:new URL(page.url()).origin},data:{action:'preview'}});expect(response.status()).toBe(200);expect((await response.json()).engine).toBe('rotation-v2');
  const before=await f.readQueueRows();await page.getByRole('button',{name:'Ułóż sprawiedliwie',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Szczegóły decyzji');await page.getByRole('dialog').getByRole('button',{name:'Anuluj',exact:true}).click();expect(await f.readQueueRows()).toEqual(before);
 }finally{await context.close();await f.cleanup();}
});
test('Product completion: search 429/500/502/503 offers one explicit retry without losing the query',async({browser})=>{
 const f=await createLocalSupabaseFixture(),context=await browser.newContext({locale:'en-US',viewport:{width:390,height:844}}),page=await context.newPage();
 try{await page.goto(`/join/${f.sessionCode}`);await page.getByLabel('Name or nickname',{exact:true}).fill('Recovery Singer');await page.getByRole('button',{name:'Join',exact:true}).click();const search=page.getByRole('searchbox');
  for(const [i,status]of [429,500,502,503].entries()){
   const q=i%2?'E2E Song':'E2E';let failed=0;
   await page.route('**/songs/search?**',async r=>{failed++;await r.fulfill({status,contentType:'application/json',body:JSON.stringify({error:{code:status===429?'SESSION_RATE_LIMITED':'SERVICE_UNAVAILABLE',message:'synthetic-internal-sentinel'}})});},{times:1});
   const rejected=page.waitForResponse(r=>r.status()===status&&new URL(r.url()).pathname.endsWith('/songs/search'));
   const results=page.locator('section[aria-labelledby="session-search-results-heading"]');
   await search.fill(q);await rejected;await expect(results.getByRole('alert')).toBeVisible();expect(await page.locator('body').innerText()).not.toContain('synthetic-internal-sentinel');expect(failed).toBe(1);
   await results.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.getByRole('button',{name:/E2E Song/}).first()).toBeVisible();await expect(search).toHaveValue(q);await expect(results.getByRole('alert')).toHaveCount(0);
  }
 }finally{await context.close();await f.cleanup();}
});

test('Product completion: real admin denial and authorized admin retry preserve the error language',async({browser})=>{
 test.skip(process.env.LOCAL_E2E_RECOVERY_FIXTURES!=='1','Source-restoring isolated fault fixture required');
 const f=await createLocalSupabaseFixture(),context=await browser.newContext({locale:'pl-PL',viewport:{width:834,height:1194}}),page=await context.newPage();
 const sql=postgres(assertLocalDatabaseTarget(process.env.LOCAL_E2E_DATABASE_URL!),{max:1,onnotice:()=>{}});let operatorId:number|undefined;
 try{
  await login(page,f);await page.goto('/admin');await expect(page.locator('[data-admin-access-denied] [data-recovery-kind="forbidden"]')).toBeVisible();
  await page.getByRole('combobox').selectOption('uk');await expect(page.locator('#recovery-title')).toHaveText(recoveryCopy.uk.states.forbidden.title);
  // Bootstrap a genuine eligible owner, never disable the owner invariant. Keep
  // it until the guarded launcher destroys this entire synthetic database; do
  // not delete/demote a last owner through fixture cleanup or business APIs.
  // Minimal bootstrap: no additional event, workspace or catalog rows that
  // could pollute later public/search tests in the same isolated suite.
  const localAuth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.LOCAL_E2E_SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const owner=await localAuth.auth.admin.createUser({email:`recovery-owner-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')+'Aa1!',email_confirm:true});
  if(owner.error||!owner.data.user)throw new Error('Synthetic owner Auth setup failed');
  await sql.begin(async tx=>{const [op]=await tx`insert into operator_users(name,display_name,profile_completed_at,auth_user_id,password_hash,active) values(${'Recovery owner '+randomUUID()},'Recovery owner',now(),${owner.data.user!.id}::uuid,'supabase-auth-managed',true) returning id`;
   await tx`insert into platform_members(operator_user_id,role,active) values(${op.id},'platform_owner',true)`;});
  const [op]=await sql`select o.id::int from operator_users o join auth.users u on u.id=o.auth_user_id where u.email=${f.email}`;expect(op).toBeDefined();operatorId=op.id;
  await sql`insert into platform_members(operator_user_id,role,active) values(${operatorId!},'platform_admin',true)`;
  await context.setExtraHTTPHeaders({'x-kunestu-test-segment-error':'1'});await page.goto('/admin/recovery-fixture');
  await expect(page.locator('#recovery-title')).toHaveText(recoveryCopy.uk.states.unexpected.title);await expect(page.getByRole('main')).toHaveCount(1);
  expect(await page.locator('body').innerText()).not.toContain('synthetic-recovery-sentinel');
  await context.setExtraHTTPHeaders({});await page.getByRole('button',{name:recoveryCopy.uk.retry,exact:true}).click();await expect(page.getByRole('heading',{name:'Recovery fixture restored'})).toBeVisible();
  await context.setExtraHTTPHeaders({'x-kunestu-test-root-error':'1'});await page.goto('/dashboard');await expect(page.locator('[data-recovery-kind="unexpected"]')).toBeVisible();
  await expect(page.getByRole('link',{name:recoveryCopy.uk.dashboard,exact:true})).toHaveAttribute('href','/dashboard');
 }finally{try{if(operatorId)await sql`delete from platform_members where operator_user_id=${operatorId} and role='platform_admin'`;}finally{await sql.end({timeout:5});await context.close();await f.cleanup();}}
});
