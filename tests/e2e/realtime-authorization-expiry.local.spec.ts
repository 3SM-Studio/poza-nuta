import {expect, test, type Page} from '@playwright/test';
import type {createClient, SupabaseClient} from '@supabase/supabase-js';
import postgres from 'postgres';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createLocalSupabaseFixture} from './local-supabase-fixture';

declare global {interface Window {
  expirySdk: {createClient: typeof createClient};
  expiryClient: SupabaseClient;
  expirySignals: number;
  expiryTopics: Record<string, number>;
  expiryStatuses: Array<{status: string; expired: boolean; at: number}>;
}}

// The ordinary suite has one-hour tokens. Run this bounded expiry drill explicitly
// with the guarded launcher and LOCAL_E2E_SHORT_JWT=1; never shorten hosted tokens.
for (const mechanism of ['expiry', 'suspend'] as const) test(`Realtime ${mechanism} drain: cached cross-organization access expires without a cooperative client`, async ({browser}) => {
  test.skip(mechanism === 'expiry' && process.env.LOCAL_E2E_SHORT_JWT !== '1', 'Explicit isolated 120-second JWT drill only');
  test.setTimeout(240_000);
  const jwtLifetimeSeconds = process.env.LOCAL_E2E_SHORT_JWT === '1' ? 120 : 3600;
  const a = await createLocalSupabaseFixture(), b = await createLocalSupabaseFixture();
  const sql = postgres(process.env.LOCAL_E2E_DATABASE_URL!, {max: 1, onnotice: () => {}});
  const context = await browser.newContext();
  const pa = await context.newPage(), pb = await context.newPage();
  const fix = readFileSync('drizzle/0035_dashboard_queue_channel_scope.sql', 'utf8');
  const [event] = await sql`select id from events where public_id=${b.eventPublicId}::uuid`;
  const topic = `dashboard:event:${event.id}:queue`;
  const evidence: Record<string, unknown> = {startedUtc: new Date().toISOString(), localOnly: true, sourceWrites: 0};
  function suspend(value: boolean) {
    // This exact container belongs to run-local-supabase-smoke.ts. The fixture's
    // target guard already rejects remote URLs. Never accept a container argument.
    try {
      const result = execFileSync('docker', ['exec', 'supabase_realtime_pozanuta-stage1-e2e-isolated', '/app/bin/realtime', 'rpc',
        `case Realtime.Api.update_tenant_by_external_id("realtime-dev", %{suspend: ${value}}) do {:ok, _} -> IO.puts("DRAIN_OK"); _ -> raise "Isolated drain failed" end`], {encoding: 'utf8', timeout: 20_000, stdio: 'pipe'});
      expect(result).toContain('DRAIN_OK');
    } catch {throw new Error('Owned local Realtime suspension command failed');}
  }
  async function client(page: Page, credentials: {email: string; password: string}) {
    await page.goto('/sign-in');
    await page.addScriptTag({path: resolve('node_modules/@supabase/supabase-js/dist/umd/supabase.js')});
    return page.evaluate(async ({url, key, credentials}) => {
      const sdk = (window as unknown as {supabase: typeof window.expirySdk}).supabase;
      window.expiryClient = sdk.createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false}});
      window.expirySignals = 0; window.expiryStatuses = []; window.expiryTopics = {};
      const {data, error} = await window.expiryClient.auth.signInWithPassword(credentials);
      if (error || !data.session) throw new Error('Synthetic expiry login failed');
      await window.expiryClient.realtime.setAuth(data.session.access_token);
      return {expiresAt: data.session.expires_at!, remainingSeconds: data.session.expires_at! - Math.floor(Date.now() / 1000)};
    }, {url: process.env.NEXT_PUBLIC_SUPABASE_URL!, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, credentials: {email: credentials.email, password: credentials.password}});
  }
  async function join(page: Page, joinedTopic = topic) {
    return page.evaluate(t => new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Expiry join deadline')), 15_000);
      window.expiryClient.channel(t, {config: {private: true}})
        .on('broadcast', {event: 'queue_changed'}, () => {window.expirySignals++; window.expiryTopics[t] = (window.expiryTopics[t] ?? 0) + 1;})
        .on('system', {}, payload => {
          if (payload.status === 'error') window.expiryStatuses.push({status: 'SYSTEM_ERROR', expired: /expir/i.test(payload.message), at: Date.now()});
          if (payload.message === 'Server requested disconnect') window.expiryStatuses.push({status: 'SYSTEM_DRAIN', expired: false, at: Date.now()});
        })
        .subscribe((status, error) => {
          window.expiryStatuses.push({status, expired: /expir/i.test(error?.message ?? ''), at: Date.now()});
          if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {clearTimeout(timer); resolve(status);}
        });
    }), joinedTopic);
  }
  async function emit() {await sql`update song_requests set position=position where event_id=${event.id}`;}
  try {
    const token = await client(pa, a); await client(pb, b);
    expect(token.remainingSeconds).toBeGreaterThan(jwtLifetimeSeconds - 30); expect(token.remainingSeconds).toBeLessThanOrEqual(jwtLifetimeSeconds);
    await sql.unsafe(`alter policy "active operators can receive dashboard queue broadcasts" on realtime.messages using(extension='broadcast' and (select realtime.topic()) ~ '^dashboard:event:[0-9]+:queue$' and (select private.is_active_dashboard_operator()));`);
    expect(await join(pa)).toBe('SUBSCRIBED'); expect(await join(pb)).toBe('SUBSCRIBED');
    await expect.poll(async () => {await emit(); return pa.evaluate(() => window.expirySignals);}).toBeGreaterThan(0);
    await sql.unsafe(fix);
    const policyCommittedAt = Date.now(), before = await pa.evaluate(() => window.expirySignals);
    await expect.poll(async () => {await emit(); return pa.evaluate(() => window.expirySignals);}).toBeGreaterThan(before);
    // No removeChannel, disconnect, refresh or other cooperation from A. The
    // server must terminate the old authorization when its original JWT expires.
    if (mechanism === 'suspend') suspend(true);
    await expect.poll(() => pa.evaluate(mode => window.expiryStatuses.some(x => mode === 'suspend' ? x.status === 'SYSTEM_DRAIN' : (x.status === 'SYSTEM_ERROR' || x.status === 'CHANNEL_ERROR') && x.expired), mechanism), {timeout: mechanism === 'expiry' ? 145_000 : 15_000, intervals: [250]}).toBe(true);
    const terminatedAt = Date.now();
    if (mechanism === 'expiry') {
      expect(terminatedAt).toBeGreaterThanOrEqual(token.expiresAt * 1000);
      expect(terminatedAt - token.expiresAt * 1000).toBeLessThan(15_000);
    } else {expect(terminatedAt).toBeLessThan(token.expiresAt * 1000); suspend(false);}
    // Reauthorize the legitimate observer, then use its delivery as a fence for
    // the negative assertion. Never infer revocation from silence alone.
    await pb.evaluate(async () => {
      const {data, error} = await window.expiryClient.auth.refreshSession();
      if (error || !data.session) throw new Error('Synthetic observer renewal failed');
      await window.expiryClient.realtime.setAuth(data.session.access_token);
      await window.expiryClient.removeAllChannels(); window.expirySignals = 0;
    });
    expect(await join(pb)).toBe('SUBSCRIBED');
    const publicTopic = `public:session:${b.publicToken}:queue`;
    expect(await join(pb, publicTopic)).toBe('SUBSCRIBED');
    const deniedCount = await pa.evaluate(() => window.expirySignals);
    await expect.poll(async () => {await emit(); return pb.evaluate(() => window.expirySignals);}).toBeGreaterThan(0);
    await expect.poll(() => pb.evaluate(t => window.expiryTopics[t] ?? 0, publicTopic)).toBeGreaterThan(0);
    await expect.poll(() => pb.evaluate(t => window.expiryTopics[t] ?? 0, topic)).toBeGreaterThan(0);
    await expect.poll(() => pa.evaluate(() => window.expirySignals), {timeout: 3000}).toBe(deniedCount);
    await pa.evaluate(async mode => {
      if (mode === 'expiry') {
        const {data, error} = await window.expiryClient.auth.refreshSession();
        if (error || !data.session) throw new Error('Synthetic actor renewal failed');
        await window.expiryClient.realtime.setAuth(data.session.access_token);
      }
      await window.expiryClient.removeAllChannels();
    }, mechanism);
    expect(await join(pa)).toBe('CHANNEL_ERROR');
    Object.assign(evidence, {status: 'PASS', mechanism, jwtLifetimeSeconds, policyCommitUtc: new Date(policyCommittedAt).toISOString(), serverTerminatedOldAuthorization: true, expiryDetectionLagMs: mechanism === 'expiry' ? terminatedAt - token.expiresAt * 1000 : null, drainAfterPolicyMs: terminatedAt - policyCommittedAt, cooperativeDisconnectRequired: false, postDrainDeliveryToA: 0, authorizedObserverDelivery: true, publicQueueDelivery: true, crossOrganizationRejoin: 'CHANNEL_ERROR', actorTokenRenewed: mechanism === 'expiry'});
  } finally {
    evidence.actorStatuses = await pa.evaluate(() => window.expiryStatuses ?? []);
    if (mechanism === 'suspend') suspend(false);
    await sql.unsafe(fix);
    writeFileSync(`.artifacts/predeploy-realtime-${mechanism}.json`, JSON.stringify(evidence, null, 2) + '\n');
    await context.close(); await sql.end({timeout: 5}); await a.cleanup(); await b.cleanup();
  }
});
