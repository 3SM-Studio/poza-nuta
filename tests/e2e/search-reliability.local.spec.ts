import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { createLocalSupabaseFixture } from "./local-supabase-fixture";

test("Search reliability: PL/EN/UK, rapid typing, real SQL and retrying the same query after 503", async ({browser}) => {
  test.setTimeout(180000);
  const fixture = await createLocalSupabaseFixture();
  await fixture.seedSearchCatalog();
  const measurements: unknown[] = [];
  const orderedIds = new Map<string,number[]>();
  const contexts = [];
  try {
    for (const [locale, label, join, nickname, error] of [
      ['pl-PL','Imię lub ksywka','Dołącz','Search PL','Nie udało się wyszukać piosenek. Spróbuj ponownie.'],
      ['en-US','Name or nickname','Join','Search EN','Songs could not be searched. Try again.'],
      ['uk-UA','Ім’я або нік','Приєднатися','Search UK','Не вдалося знайти пісні. Спробуйте ще раз.'],
    ]) {
      const context = await browser.newContext({locale, viewport: {width: locale==='pl-PL'?1440:390,height:900},hasTouch:locale==='uk-UA',isMobile:locale==='uk-UA'});
      contexts.push(context);
      const page = await context.newPage();
      await page.goto(`/join/${fixture.sessionCode}`);
      await page.getByLabel(label,{exact:true}).fill(nickname);
      await page.getByRole('button',{name:join,exact:true}).click();
      const search = page.getByRole('searchbox'); await expect(search).toBeVisible();
      let gets=0; page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/songs/search'))gets++;});
      await page.route('**/songs/search?**', async route => {
        await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'The service is temporarily unavailable.'}})});
      },{times:1});
      await search.pressSequentially('Dancing Queen',{delay:40});
      await expect(page.getByText(error,{exact:true})).toBeVisible();
      expect(gets).toBe(1);
      const started=performance.now();
      const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/songs/search')&&r.status()===200);
      await search.press('Enter'); await response;
      await expect(page.getByRole('button',{name:/Dancing Queen/}).first()).toBeVisible();
      expect(gets).toBe(2); expect(await search.inputValue()).toBe('Dancing Queen');
      measurements.push({locale,retryToVisibleMs:performance.now()-started,searchRequests:gets});
      if(process.env.SONG_SEARCH_ENGINE==='unicode-v2') {
        for(const [query,title] of [['Gorniak','To nie ja'],['Кино','Группа крови'],['光','光']]) {
          const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/songs/search') && new URL(r.url()).searchParams.get('q')===query && r.status()===200);
          await search.fill(query); const payload: {items:{id:number}[]} = await (await response).json();
          await expect(page.getByRole('button',{name:new RegExp(title)}).first()).toBeVisible();
          const ids=payload.items.map(song=>song.id);
          if(orderedIds.has(query)) expect(ids).toEqual(orderedIds.get(query)); else orderedIds.set(query,ids);
        }
      }
    }
    writeFileSync('.artifacts/search-reliability-browser.json',JSON.stringify({utc:new Date().toISOString(),browser:browser.version(),node:process.version,engine:process.env.SONG_SEARCH_ENGINE,optimized:process.env.LOCAL_E2E_OPTIMIZED==='1',measurements,physicalTouch:false},null,2));
  } finally { await Promise.all(contexts.map(c=>c.close())); await fixture.cleanup(); }
});
