import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { assertLocalApiTarget, assertLocalDatabaseTarget, assertLocalE2ETarget, registerPostgresTestPort, unregisterPostgresTestPort } from '../src/lib/local-target.ts';
import { cleanToolEnvironment, localApplicationEnvironment } from '../scripts/isolated-environment.ts';
import { requireAdminDatabaseUrl } from '../src/db/admin-database-url.ts';
import { requireRuntimeDatabaseUrl } from '../src/server/database-connection-config.ts';

const db = 'postgresql://postgres:synthetic@127.0.0.1:55432/postgres';
const local = () => ({ ...localApplicationEnvironment({}, {
  databaseUrl: db, apiUrl: 'http://127.0.0.1:55431', publishableKey: 'synthetic-public',
  secretKey: 'synthetic-admin', origin: 'http://localhost:3105',
}), LOCAL_E2E_DATABASE_URL: db, E2E_BASE_URL: 'http://localhost:3105' });

test('database guards reject remote, production, unknown local and ambiguous targets without echoing credentials', () => {
  for (const value of [undefined, '', 'postgres://secret@db.qwmimnhdnzqfckswxjww.supabase.co:5432/postgres',
    'postgres://secret@unknown.example:5432/postgres', 'postgres://secret@127.0.0.1:54322/postgres',
    'postgres://secret@127.0.0.1:55522/unknown_database',
    'postgres://secret@localhost:55432/postgres', 'postgres://secret@127.0.0.1:55432/postgres?host=remote',
    'postgres://secret@127.0.0.1:55432/postgres#remote', 'https://127.0.0.1:55432/postgres']) {
    assert.throws(() => assertLocalDatabaseTarget(value), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes('secret'));
      return true;
    });
  }
});
test('test and administrative guards cannot be bypassed by cloud markers', () => {
  const remote = 'postgres://postgres.example:synthetic@aws-0-eu.pooler.supabase.com:6543/postgres';
  assert.throws(() => requireAdminDatabaseUrl({ DIRECT_URL: remote, VERCEL: '1' }));
  assert.throws(() => requireRuntimeDatabaseUrl({ DATABASE_URL: remote, VERCEL: '1', NODE_ENV: 'test' }));
  assert.throws(() => requireRuntimeDatabaseUrl({ DATABASE_URL: remote, VERCEL: '1', NODE_ENV: 'development' }));
  assert.throws(() => requireRuntimeDatabaseUrl({ DATABASE_URL: remote, VERCEL: '1', NODE_ENV: 'production', KUNESTU_LOCAL: '1' }));
});
test('local Auth and database must belong to the same profile', () => {
  assert.doesNotThrow(() => assertLocalE2ETarget(local()));
  for (const api of ['https://qwmimnhdnzqfckswxjww.supabase.co', 'http://127.0.0.1:55521',
    'http://user:synthetic@127.0.0.1:55431', 'http://127.0.0.1:55431/path']) {
    assert.throws(() => assertLocalApiTarget(api, db));
  }
  assert.throws(() => assertLocalE2ETarget({ ...local(), E2E_BASE_URL: 'https://production.example' }));
  assert.throws(() => assertLocalE2ETarget({ ...local(), SUPABASE_URL: 'https://production.example' }));
});
test('only an explicitly registered disposable PostgreSQL port is accepted', () => {
  const value = 'postgres://127.0.0.1:61119/test_fixture';
  assert.throws(() => assertLocalDatabaseTarget(value));
  registerPostgresTestPort(61119);
  assert.equal(assertLocalDatabaseTarget(value), value);
  assert.equal(assertLocalDatabaseTarget(value + '?application_name=rotation-test'), value + '?application_name=rotation-test');
  assert.throws(() => assertLocalDatabaseTarget(value + '?application_name=rotation&host=remote'));
  assert.throws(() => assertLocalDatabaseTarget('postgres://remote.example:61119/test_fixture'));
  unregisterPostgresTestPort(61119);
  assert.throws(() => assertLocalDatabaseTarget(value));
});
test('poisoned parent credentials and test flags are not inherited', () => {
  const sentinel = 'production-credential-sentinel';
  const parent = Object.fromEntries(['DATABASE_URL', 'DIRECT_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'IMPORT_WORKER_DATABASE_URL',
    'AUTH_INVITE_COOKIE_SECRET', 'PLATFORM_SETUP_TOKEN_SHA256', 'VERCEL_OIDC_TOKEN', 'VERCEL',
    'E2E_OPERATOR_PASSWORD', 'NODE_OPTIONS', 'ISING_CLIENT_ID'].map(key => [key, sentinel]));
  assert.deepEqual(cleanToolEnvironment(parent), { NODE_ENV: 'test' });
  const env = localApplicationEnvironment(parent, { databaseUrl: db, apiUrl: 'http://127.0.0.1:55431',
    publishableKey: 'synthetic', secretKey: 'synthetic', origin: 'http://localhost:3105' });
  assert.ok(!JSON.stringify(env).includes(sentinel));
});
test('E2E specifications never load dotenv/root environment files', () => {
  for (const file of readdirSync('tests/e2e').filter(file => /\.(ts|mjs)$/.test(file))) {
    const source = readFileSync(`tests/e2e/${file}`, 'utf8');
    assert.doesNotMatch(source, /(?:from\s+["']dotenv|dotenv\.config|readFile\w*\([^\n]*["']\.env)/, file);
  }
});
