import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { parse } from 'dotenv';
import { cleanToolEnvironment, localApplicationEnvironment } from './isolated-environment.ts';
import { assertLocalDatabaseTarget } from '../src/lib/local-target.ts';

const exec = promisify(execFile);
const workdir = resolve('.artifacts/local-development');
const cliVersion = '2.109.1';
async function cli(args: string[]) {
  // CLI output can contain credentials; capture it, never forward it to terminal logs.
  const command = `pnpm dlx supabase@${cliVersion} --workdir .artifacts/local-development --yes ${args.join(' ')}`;
  try {
    return (await exec(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], {
      env: cleanToolEnvironment(process.env), windowsHide: true, timeout: 240_000, maxBuffer: 8_000_000,
    })).stdout;
  } catch (error) {
    const diagnostic = error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
      ? error.stderr.split(/\r?\n/).filter(line => !/key|token|secret|password|jwt|url|postgres:\/\//i.test(line)).slice(-8).join('\n') : '';
    throw new Error(`Local Supabase ${args[0]} failed. ${diagnostic}`);
  }
}

const action = process.argv[2];
if (!['up', 'down', 'env'].includes(action ?? '')) throw new Error('Use local:up, local:down or local:env.');
await mkdir(resolve(workdir, 'supabase'), { recursive: true });
await writeFile(resolve(workdir, 'supabase/config.toml'), await readFile('supabase/config.toml'));
if (action === 'down') {
  await cli(['stop', '--project-id', 'pozanuta-stage1-dev']);
  console.log('Local stack stopped; data preserved.');
} else {
  if (action === 'up') {
    console.log('Starting owned local Supabase (PostgreSQL 17, Auth, Realtime, mail capture).');
    await cli(['start', '--exclude', 'analytics,edge-runtime,functions,imgproxy,meta,storage,studio,vector']);
  }
  const status = Object.fromEntries((await cli(['status', '--output', 'env'])).split(/\r?\n/)
    .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')];
    }));
  const databaseUrl = assertLocalDatabaseTarget(status.DB_URL);
  if (new URL(databaseUrl).port !== '55522') throw new Error('Unexpected development database port.');
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const [row] = await client`select current_setting('server_version_num')::integer as version`;
    if (row.version < 170000 || row.version >= 180000) throw new Error('PostgreSQL 17 is required.');
    console.log(`Verified local PostgreSQL ${row.version}; API 55521, DB 55522.`);
  } finally { await client.end(); }
  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  if (!publishableKey || !secretKey) throw new Error('Local Auth credentials missing.');
  const local = localApplicationEnvironment({}, { databaseUrl, apiUrl: 'http://127.0.0.1:55521',
    origin: 'http://localhost:3000', publishableKey, secretKey });
  let previous = '';
  try { previous = await readFile('.env.local', 'utf8'); } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  if (previous && !previous.startsWith('# Owned local Supabase only.')) {
    throw new Error('Refusing to overwrite an unmanaged .env.local. Quarantine it explicitly first.');
  }
  const previousValues = parse(previous);
  const runtimeNames = ['KUNESTU_LOCAL', 'DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_URL', 'SITE_URL'];
  const adminNames = ['KUNESTU_LOCAL', 'DIRECT_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'OPERATOR_BOOTSTRAP_PIN', 'OPERATOR_BOOTSTRAP_NAME'];
  const authNames = ['AUTH_INVITE_COOKIE_SECRET', 'PLATFORM_SETUP_TOKEN_SHA256'];
  for (const [filename, names] of [
    ['.env.local', runtimeNames], ['.env.admin.local', adminNames], ['.env.auth.local', authNames],
    ['.env.worker.local', ['IMPORT_WORKER_DATABASE_URL', 'ISING_API_BASE_URL', 'ISING_CLIENT_ID']],
  ] as const) {
    let oldValues: Record<string, string> = {};
    if (filename !== '.env.local') {
      try { oldValues = parse(await readFile(filename, 'utf8')); } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      if (Object.keys(oldValues).length) continue;
    }
    const values: Record<string, string | undefined> = local;
    await writeFile(filename, '# Owned local Supabase only. Never pull Vercel environment into this file.\n' +
      names.map(key => `${key}=${JSON.stringify(previousValues[key] ?? values[key] ?? '')}`).join('\n') + '\n', { mode: 0o600 });
  }
  console.log('Separated runtime, administration, Auth/invites and disabled worker environments. Run pnpm db:migrate.');
}
