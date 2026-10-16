import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { assertLocalDatabaseTarget } from '../src/lib/local-target.ts';

const results: Record<string, boolean | number> = {};
let stage = 'configuration';
const fixture = JSON.parse(await readFile('.artifacts/local-development/operator.json', 'utf8'));
const admin = parse(await readFile('.env.admin.local', 'utf8'));
const url = assertLocalDatabaseTarget(admin.DIRECT_URL);
if (new URL(url).port !== '55522') throw new Error('Local development stack required.');
const browser = await chromium.launch();
const client = postgres(url, { max: 1, onnotice: () => undefined });
try {
  const context = await browser.newContext({ baseURL: 'http://localhost:3000' });
  const forbidden = new Set<string>();
  await context.route('**/*', async route => {
    const target = new URL(route.request().url());
    if (['http://localhost:3000', 'http://127.0.0.1:55521'].includes(target.origin)) await route.continue();
    else { forbidden.add(target.hostname); await route.abort(); }
  });
  const page = await context.newPage();
  stage = 'local operator sign-in';
  await page.goto('/sign-in');
  await page.getByLabel('E-mail').fill(fixture.email);
  await page.getByLabel('Hasło', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
  results.operatorSignIn = true;
  stage = 'participants and queue';
  for (const suffix of ['participants', 'queue']) {
    const response = await page.goto(`/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/${suffix}`);
    assert.equal(response?.status(), 200);
    await expect(page.getByText('column event_participants.merged_into_id does not exist')).toHaveCount(0);
    if (suffix === 'queue') await expect(page.locator('[data-realtime-status="live"]:visible')).toBeVisible({ timeout: 20_000 });
    results[suffix] = true;
  }
  assert.equal(forbidden.size, 0, `Unexpected browser host: ${[...forbidden].join(',')}`);
  results.noExternalBrowserRequests = true;
  await context.close();
  stage = 'fresh signup';
  const signup = await browser.newContext({ baseURL: 'http://localhost:3000' });
  const signupPage = await signup.newPage();
  const mailbox = `isolation-${randomBytes(8).toString('hex')}`;
  const email = `${mailbox}@example.test`;
  const password = randomBytes(24).toString('base64url') + 'Aa1!';
  await signupPage.goto('/sign-up');
  await signupPage.locator('#signup-email').fill(email);
  await signupPage.locator('#signup-password').fill(password);
  await signupPage.locator('#signup-confirm-password').fill(password);
  await signupPage.getByRole('button', { name: 'Załóż konto', exact: true }).click();
  await expect(signupPage.getByRole('heading', { name: 'Sprawdź email' })).toBeVisible({ timeout: 20_000 });
  stage = 'local email confirmation';
  let messageId: string | undefined;
  for (let attempt = 0; attempt < 20 && !messageId; attempt++) {
    const inbox = await (await fetch('http://127.0.0.1:55524/api/v1/messages')).json();
    messageId = inbox.messages?.find((message: { To: { Address: string }[] }) => message.To.some(recipient => recipient.Address === email))?.ID;
    if (!messageId) await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(messageId, 'Local confirmation email missing.');
  const message = await (await fetch(`http://127.0.0.1:55524/api/v1/message/${messageId}`)).json();
  const confirmation = message.HTML.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1]?.replaceAll('&amp;', '&');
  assert.ok(confirmation, 'Local confirmation link missing.');
  const target = new URL(confirmation);
  assert.equal(target.origin, 'http://127.0.0.1:55521');
  const redirect = new URL(target.searchParams.get('redirect_to')!);
  assert.equal(redirect.origin, 'http://localhost:3000');
  assert.equal(redirect.pathname, '/auth/callback');
  let callbackObserved = false;
  signupPage.on('request', request => {
    if (new URL(request.url()).pathname === '/auth/callback') callbackObserved = true;
  });
  await signupPage.goto(confirmation);
  await expect(signupPage).toHaveURL(/localhost:3000\/dashboard/, { timeout: 30_000 });
  assert.equal(callbackObserved, true);
  const [confirmed] = await client`select email_confirmed_at is not null as confirmed from auth.users where email = ${email}`;
  assert.equal(confirmed.confirmed, true);
  results.freshSignupCallbackAndConfirmation = true;
  await signup.close();
  stage = 'schema verification';
  const [engine] = await client`select current_setting('server_version_num')::integer as version`;
  const [history] = await client`select count(*)::integer as count from drizzle.__drizzle_migrations`;
  const columns = await client`select column_name from information_schema.columns where table_schema='public' and table_name='event_participants' and column_name='merged_into_id'`;
  assert.equal(columns.length, 1);
  assert.equal(history.count, 31);
  results.postgresVersion = engine.version;
  results.migrations = history.count;
  results.mergeColumn = true;
  await writeFile('.artifacts/local-isolation-runtime.json', JSON.stringify(results, null, 2));
  console.log('Local runtime, isolated browser, participants, queue/Realtime and signup confirmation: PASS.');
} catch (error) {
  const diagnostic = error instanceof Error ? error.message.split('\n').slice(0, 5).join(' ')
    .replace(/https?:\/\/\S+/g, '[local URL withheld]')
    .replaceAll(fixture.password, '[withheld]').replaceAll(fixture.email, '[synthetic email]') : 'Unknown verification failure';
  await writeFile('.artifacts/local-isolation-runtime.json', JSON.stringify({ ...results, failedStage: stage, diagnostic }, null, 2));
  console.error(`Local verification failed at: ${stage}. Credentials and callback URLs withheld.`);
  process.exitCode = 1;
} finally { await browser.close(); await client.end(); }
