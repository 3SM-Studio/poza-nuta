import {expect,test,type Page} from '@playwright/test';
import {createLocalSupabaseFixture} from './local-supabase-fixture';

test('Integrated EN and UK participants retain independent languages and canonical identity with a PL operator',async({browser})=>{
 test.setTimeout(180000);
 const fixture=await createLocalSupabaseFixture(),contexts=await Promise.all([
  browser.newContext({locale:'pl-PL',viewport:{width:1440,height:1000}}),
  browser.newContext({locale:'en-US',viewport:{width:390,height:844}}),
  browser.newContext({locale:'uk-UA',viewport:{width:390,height:844}}),
 ]);
 const [operator,en,uk]=await Promise.all(contexts.map(c=>c.newPage()));
 const row=(name:string)=>operator.locator('[data-queue-request-id]:visible').filter({has:operator.locator('strong',{hasText:new RegExp('^'+name+'$')})});
 const errors:string[]=[];for(const p of [operator,en,uk]){p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));}
 try{
  await operator.goto('/sign-in');await operator.waitForFunction(()=>{const e=document.querySelector('#operator-email');return e&&Object.keys(e).some(k=>k.startsWith('__reactProps'));});await operator.locator('#operator-email').fill(fixture.email);await operator.locator('#operator-password').fill(fixture.password);await operator.getByRole('button',{name:'Zaloguj się',exact:true}).click();
  await operator.waitForURL(/\/dashboard/);await operator.waitForLoadState('networkidle');await operator.goto(`/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`);
  async function join(p:Page,locale:string,label:string,button:string,name:string){
   await p.goto(`/join/${fixture.sessionCode}`);await expect(p.locator('html')).toHaveAttribute('lang',locale);await p.getByLabel(label,{exact:true}).fill(name);await p.getByRole('button',{name:button,exact:true}).click();
  }
  await join(en,'en','Name or nickname','Join','English Singer');await join(uk,'uk','Ім’я або нік','Приєднатися','Співак');
  for(const [p,add,name] of [[en,'Add to queue','English Singer'],[uk,'Додати до черги','Співак']] as const){
   await p.getByRole('searchbox').fill('E2E Song');await p.getByRole('button',{name:/E2E Song/}).click();await p.getByRole('button',{name:add,exact:true}).click();
   await expect(row(name)).toBeVisible();await row(name).getByRole('button',{name:/^Zaakceptuj:/}).click();await expect(operator.locator('[data-queue-sync-state]:visible')).toHaveAttribute('data-queue-sync-state','synced');
  }
  const original=(await fixture.readParticipantRequests('Співак'))[0];
  await en.getByRole('banner').getByRole('button',{name:'Open queue',exact:true}).click();await uk.getByRole('banner').getByRole('button',{name:'Відкрити чергу',exact:true}).click();
  await en.getByRole('tab',{name:/^Queue/}).click();await uk.getByRole('tab',{name:/^Черга/}).click();
  for(const p of [en,uk])for(const name of ['English Singer','Співак'])await expect(p.getByRole('dialog').locator('article').filter({hasText:name})).toHaveCount(1);
  await uk.getByRole('button',{name:'Згорнути чергу',exact:true}).click();
  await uk.getByRole('button',{name:'Змінити свій нік'}).click();await uk.getByLabel('Ваш нік',{exact:true}).fill('Голос');await uk.getByRole('button',{name:'Зберегти',exact:true}).click();
  await expect(row('Голос')).toBeVisible();await expect(en.getByRole('dialog').locator('article').filter({hasText:'Голос'})).toHaveCount(1);
  await uk.getByRole('button',{name:'Мова інтерфейсу'}).click();await uk.getByRole('menuitemradio',{name:'English',exact:true}).click();await expect(uk.locator('html')).toHaveAttribute('lang','en');await uk.reload();await expect(uk.locator('html')).toHaveAttribute('lang','en');
  await uk.getByRole('button',{name:'Interface language'}).click();await uk.getByRole('menuitemradio',{name:'Українська',exact:true}).click();await expect(uk.locator('html')).toHaveAttribute('lang','uk');
  await expect(en.locator('html')).toHaveAttribute('lang','en');await expect(operator.locator('html')).toHaveAttribute('lang','pl');
  const final=(await fixture.readParticipantRequests('Голос'))[0];expect(final.eventParticipantId).toBe(original.eventParticipantId);expect(final.requestDisplayName).toBe('Співак');expect(errors).toEqual([]);
 }finally{try{await Promise.all(contexts.map(c=>c.close()));}finally{await fixture.cleanup();}}
});
