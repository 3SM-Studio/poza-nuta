import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';

// Read-only browser coverage. Never load env/fixtures or allow a remote request
// or application mutation. Run against the already verified local launcher.
const origin = 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const passed = [], runtimeErrors = [], blockedRequests = [];
try {
  for (const [header, expected] of [
    ['pl-PL', 'pl'], ['uk-UA', 'uk'], ['en-US', 'en'], ['es-ES', 'en'],
    ['ru-RU', 'en'], ['ar-SA', 'en'], ['es-ES,uk-UA;q=0.9,en;q=0.8', 'uk'],
    ['uk;q=0.7,pl;q=0.9,en;q=0.8', 'pl'], ['uk;q=0.8,pl;q=0.8', 'uk'],
  ]) {
    const context = await browser.newContext({ locale: 'es-ES', viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'Accept-Language': header } });
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['GET', 'HEAD'].includes(request.method())) {
        blockedRequests.push({ method: request.method(), host: url.hostname });
        return route.abort();
      }
      // Chromium's locale emulation can replace extraHTTPHeaders. Set the
      // exact negotiation header on the request that reaches the server.
      return route.continue({ headers: { ...request.headers(), 'accept-language': header } });
    });
    const page = await context.newPage();
    page.on('pageerror', error => runtimeErrors.push(error.message));
    await page.goto(origin + '/join');
    await expect(page.locator('html')).toHaveAttribute('lang', expected);
    passed.push(`Browser ${header} → ${expected}`);
    if (header === 'es-ES') {
      await expect(page.getByRole('heading', { name: 'Enter the event code' })).toBeVisible();
      await page.locator('#session-code').fill('123456');
      await page.getByRole('button', { name: 'Interface language' }).click();
      for (const name of ['Polski', 'English', 'Українська']) await expect(page.getByRole('menuitemradio', { name })).toBeVisible();
      await page.getByRole('menuitemradio', { name: 'Polski' }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
      await expect(page.locator('#session-code')).toHaveValue('123456');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
      passed.push('EN fallback shows every language; manual PL persists over unsupported browser after reload');
      await page.getByRole('button', { name: 'Język interfejsu' }).click();
      await page.getByRole('menuitemradio', { name: 'Українська' }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
      passed.push('Manual UK persists over unsupported browser after reload');
      await context.clearCookies();
      await page.goto(origin + '/sign-in');
      await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
      await page.getByRole('link', { name: 'Przejdź na stronę główną', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      passed.push('Unmatched management stays PL; client navigation back to public restores EN fallback');
    }
    await context.close();
  }
  expect(runtimeErrors).toEqual([]);
  expect(blockedRequests).toEqual([]);
  fs.writeFileSync('.artifacts/i18n-en-fallback-browser-result.json', JSON.stringify({ passed, runtimeErrors, blockedRequests, environment: 'Local optimized Next build, Chromium, 390×844 viewport emulation; no mutation requests allowed' }, null, 2));
  console.log(JSON.stringify({ passed: passed.length, runtimeErrors: runtimeErrors.length, blockedRequests: blockedRequests.length }));
} finally { await browser.close(); }
