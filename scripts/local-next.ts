import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { cleanToolEnvironment } from './isolated-environment.ts';
import { assertLocalApiTarget, assertLocalDatabaseTarget } from '../src/lib/local-target.ts';
import { assertNoCloudEnvironmentFiles } from './local-environment-files.ts';

const action = process.argv[2];
if (!['dev', 'build', 'start'].includes(action ?? '')) throw new Error('Unknown Next command.');
// Deployment runtime/build semantics are unchanged; local development never inherits cloud env.
const isCloud = action !== 'dev' && process.env.VERCEL === '1' && process.env.KUNESTU_LOCAL !== '1';
let environment = process.env;
if (!isCloud) {
  assertNoCloudEnvironmentFiles();
  const text = readFileSync('.env.local', 'utf8');
  if (!text.startsWith('# Owned local Supabase only.')) throw new Error('Run pnpm local:up first.');
  const local = parse(text);
  const db = assertLocalDatabaseTarget(local.DATABASE_URL);
  assertLocalApiTarget(local.NEXT_PUBLIC_SUPABASE_URL, db);
  assertLocalApiTarget(local.SUPABASE_URL, db);
  if (new URL(db).port !== '55522') throw new Error('Development requires its own persistent stack.');
  const auth = parse(readFileSync('.env.auth.local', 'utf8'));
  // Runtime receives only the signing secret required for invite cookies; no admin/worker credentials.
  environment = { ...cleanToolEnvironment(process.env), ...local,
    AUTH_INVITE_COOKIE_SECRET: auth.AUTH_INVITE_COOKIE_SECRET, KUNESTU_LOCAL: '1',
    SONG_SEARCH_ENGINE: process.env.SONG_SEARCH_ENGINE ?? 'legacy',
    NODE_ENV: action === 'dev' ? 'development' : 'production' };
}
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', action!, ...process.argv.slice(3)], {
  env: environment, stdio: 'inherit', windowsHide: true,
});
child.on('error', () => { console.error('Next process could not start.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
