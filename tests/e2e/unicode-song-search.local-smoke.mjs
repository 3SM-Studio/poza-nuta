import { chromium, devices, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// No env loading, migrations, seeding, cleanup, request approval or cancellation.
// The only application writes are three NEW synthetic participant identities,
// their Presence, and two requests owned by the new UK participant.
if (process.env.KUNESTU_UNICODE_LOCAL_WRITES !== '1') throw new Error('Explicit local participant-write opt-in required.');
const expectedPid = Number(process.env.KUNESTU_UNICODE_SERVER_PID);
const proof = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  '$listener=Get-NetTCPConnection -LocalPort 3000 -State Listen|Select-Object -First 1; $current=Get-CimInstance Win32_Process -Filter ("ProcessId="+$listener.OwningProcess); $managed=$false; for($step=0;$step -lt 6 -and $current;$step++){if($current.CommandLine -match "scripts[/\\\\]local-next.ts"){$managed=$true};$current=Get-CimInstance Win32_Process -Filter ("ProcessId="+$current.ParentProcessId)}; @{pid=$listener.OwningProcess;managed=$managed}|ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true }));
if (!Number.isSafeInteger(expectedPid) || proof.pid !== expectedPid || !proof.managed) throw new Error('Verified managed local application PID required.');
const preparation = JSON.parse(fs.readFileSync('.artifacts/unicode-search-local-preparation.json', 'utf8'));
if (preparation.missing !== 0 || preparation.migration !== '0031_unicode_song_search') throw new Error('Complete local projection preparation required.');
const fixture = JSON.parse(fs.readFileSync('.artifacts/local-development/operator.json', 'utf8'));
if (!fixture.email.endsWith('@example.test')) throw new Error('Synthetic operator required.');
const origin = 'http://localhost:3000', errors = [], external = [], passed = [], orders = new Map();
const ix = JSON.parse(fs.readFileSync('src/i18n/source-index.json', 'utf8'));
const dictionaries = Object.fromEntries(['pl','en','uk'].map(locale => [locale, JSON.parse(fs.readFileSync(`src/i18n/messages/${locale}.json`, 'utf8')).ui]));
const t = (locale, source) => dictionaries[locale][ix[source]];
const cases = [
  ['Górniak','To nie ja'], ['Gorniak','To nie ja'], ['Corazón','Corazón'], ['Corazon','Corazón'],
  ['Океан Ельзи','Обійми'], ['Кино','Группа крови'], ['عمرو دياب','تملي معاك'],
  ['Μίκης Θεοδωράκης','Το τρένο'], ['周杰伦','稻香'], ['宇多田ヒカル','光'],
  ['방탄소년단','봄날'], ['अरिजीत सिंह','तुम ही हो'], ['נעמי שמר','ירושלים של זהב'],
  ['นนท์ ธนนท์','รักแรก'], ['光','光'], ['周','稻香'], ['Okean Elzy','Обійми'], ['BTS','봄날'],
];
const browser = await chromium.launch({ headless: true });
try {
  let sessionUrl;
  for (const [index, locale] of ['pl','en','uk'].entries()) {
    const context = await browser.newContext({ ...(locale === 'uk' ? devices['iPhone 13'] : { viewport: { width: 1440, height: 1000 } }),
      locale: `${locale}-${locale === 'uk' ? 'UA' : locale === 'en' ? 'US' : 'PL'}`, extraHTTPHeaders: { 'x-forwarded-for': `192.0.2.${221+index}` } });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) { external.push(url.hostname); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/session/' + fixture.sessionCode);
    await expect(page).toHaveURL(/\/s\/[^/]+$/); sessionUrl ??= page.url(); expect(page.url()).toBe(sessionUrl);
    await page.getByLabel(t(locale,'Imię lub ksywka')).fill(`Search ${locale.toUpperCase()} ${Date.now().toString(36)}`);
    await page.getByRole('button', { name: t(locale,'Dołącz'), exact: true }).click();
    const input = page.getByRole('searchbox'); await expect(input).toBeVisible();
    for (const [query, title] of cases) {
      const responsePromise = page.waitForResponse(response => {
        const url = new URL(response.url()); return url.pathname.endsWith('/songs/search') && url.searchParams.get('q') === query;
      });
      await input.fill(query); const response = await responsePromise;
      expect(response.status()).toBe(200); const body = await response.json();
      expect(body.items.some(song => song.title === title), `${locale}: ${query}`).toBe(true);
      const ids = body.items.map(song => song.id);
      if (orders.has(query)) expect(ids, `locale-independent ranking: ${query}`).toEqual(orders.get(query)); else orders.set(query,ids);
      await expect(page.locator('[data-slot="session-song-row-text"] > span:first-child').filter({ hasText: title }).first()).toBeVisible();
      if (query === 'عمرو دياب') {
        await expect(input).toHaveCSS('direction','rtl');
        await expect(page.locator('[data-slot="session-song-row-text"] > span:first-child').filter({ hasText: title }).first()).toHaveAttribute('dir','auto');
        await page.screenshot({ path: `.artifacts/unicode-search-${locale}-rtl.png` });
      }
    }
    passed.push(`${locale}: ${cases.length} real browser/API searches; original Unicode titles retained; ranking identical across UI locales`);
    await input.fill('zzzzunavailablecatalogxyz');
    await expect(page.getByRole('status').filter({ hasText: t(locale,'Brak wyników. Spróbuj wpisać tytuł i wykonawcę.') })).toBeVisible();
    const browse = await page.request.get(origin + new URL(sessionUrl).pathname.replace('/s/','/api/s/') + '/songs/browse?q=' + encodeURIComponent('周'));
    expect(browse.status()).toBe(200); expect((await browse.json()).items.some(song => song.title === '稻香')).toBe(true);
    await input.fill('光'); await expect(page.locator('[data-slot="session-song-row-text"] > span:first-child').filter({ hasText:'光' }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.artifacts/unicode-search-${locale}-cjk.png` });
    passed.push(`${locale}: absent title, Unicode browse filter, one-character CJK and responsive layout`);
    if (locale === 'uk') {
      for (const [index, title] of ['تملي معاك','光'].entries()) {
        await input.fill(title);
        await page.locator('[data-slot="session-song-row"]').filter({hasText:title}).first().click();
        await page.getByRole('button',{name:t(locale,'Dodaj do kolejki'),exact:true}).click();
        await expect(page.locator('[data-sonner-toast]').filter({hasText:t(locale,'Dodano zgłoszenie')}).first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByText(t(locale,'Aktywne zgłoszenia: {v0}/{v1}').replace('{v0}',String(index+1)).replace('{v1}','2'),{exact:true})).toBeVisible();
      }
      await input.fill('Corazón');
      await page.locator('[data-slot="session-song-row"]').filter({hasText:'Corazón'}).first().click();
      await page.getByRole('button',{name:t(locale,'Dodaj do kolejki'),exact:true}).click();
      await expect(page.locator('[data-session-state="request_limit"]')).toContainText(t(locale,'Masz już 2 aktywne zgłoszenia'));
      await page.keyboard.press('Escape');
      passed.push('UK participant requests Arabic and Japanese originals; real API enforces 2/2 and localized rejection');
    }
    await context.close();
  }
  const context = await browser.newContext({ locale:'en-US', extraHTTPHeaders:{'x-forwarded-for':'192.0.2.224'} });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => { const u=new URL(route.request().url());if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)){external.push(u.hostname);return route.abort()}return route.continue(); });
  const apiPath = origin + new URL(sessionUrl).pathname.replace('/s/','/api/s/') + '/songs/search';
  expect((await context.request.get(apiPath+'?q='+'a'.repeat(101))).status()).toBe(400);
  const wildcard = await context.request.get(apiPath+'?q=%25%25%25');expect(wildcard.status()).toBe(200);expect((await wildcard.json()).items).toEqual([]);
  const injection = await context.request.get(apiPath+'?q='+encodeURIComponent("' OR 1=1;--"));expect(injection.status()).toBe(200);
  const plainText = await context.request.get(apiPath+'?q='+encodeURIComponent('or 1 1'));expect(plainText.status()).toBe(200);
  expect((await injection.json()).items).toEqual((await plainText.json()).items);
  expect((await context.request.get(origin+'/api/s/invalid-token/songs/search?q='+encodeURIComponent('光'))).status()).toBe(404);
  passed.push('Real API rejects overlong input, neutralizes wildcard/injection input, and denies invalid session scope');
  const base=`/api/dashboard/organizations/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/participants/songs`;
  // Public token cannot replace dashboard authentication.
  const denied = await context.request.get(origin+base+'?q='+encodeURIComponent('光'));
  expect(denied.status()).toBe(401);
  await page.goto(origin+'/sign-in');await page.getByLabel('Email',{exact:true}).fill(fixture.email);
  await page.getByLabel('Password',{exact:true}).fill(fixture.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page).toHaveURL(/\/dashboard/);await expect(page.getByRole('button',{name:'Interface language'})).toBeVisible();
  await page.waitForLoadState('networkidle');
  const operator=await context.request.get(origin+base+'?q='+encodeURIComponent('光'));expect(operator.status()).toBe(200);
  expect((await operator.json()).items.some(song=>song.title==='光')).toBe(true);
  passed.push('Authenticated operator uses Unicode catalog search; unauthenticated operator access denied');
  expect(errors).toEqual([]);expect(external).toEqual([]);
  fs.writeFileSync('.artifacts/unicode-search-browser-result.json',JSON.stringify({passed,searchCasesPerLanguage:cases.length,localeIndependentQueries:orders.size,runtimeErrors:errors.length,externalRequests:external.length,syntheticParticipantsCreated:3,syntheticRequestsCreated:2,browser:browser.version(),touch:'UK: Chromium iPhone 13 emulation, not physical hardware'},null,2));
  console.log(JSON.stringify({passed:passed.length,searchCasesPerLanguage:cases.length,runtimeErrors:errors.length}));
} finally { await browser.close(); }
