import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';
import { cleanToolEnvironment } from '../scripts/isolated-environment.ts';

test('real seed, worker, migration and E2E entry points reject an unknown target before opening a socket', async () => {
  let connections = 0;
  const listener = createServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  assert.ok(![55432, 55522].includes(address.port));
  const credential = 'synthetic-negative-path-secret';
  const target = `postgres://postgres:${credential}@127.0.0.1:${address.port}/postgres`;
  const environment = { ...cleanToolEnvironment(process.env), DIRECT_URL: target, DATABASE_URL: target,
    UNICODE_SEARCH_LOCAL_DATABASE_URL: target,
    IMPORT_WORKER_DATABASE_URL: target, ISING_CLIENT_ID: 'synthetic', LOCAL_E2E_DATABASE_URL: target,
    E2E_BASE_URL: 'http://localhost:3105', SUPABASE_URL: 'http://127.0.0.1:55431',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55431', LOCAL_E2E_SUPABASE_SECRET_KEY: credential, KUNESTU_LOCAL:'1', LOCAL_E2E_OPTIMIZED:'1' };
  async function denied(command: string, args: string[]) {
    const result = await new Promise<{ failed: boolean; output: string }>(resolve => {
      execFile(command, args, { env: environment, timeout: 30_000, windowsHide: true }, (error, stdout, stderr) => {
        resolve({ failed: !!error, output: stdout + stderr });
      });
    });
    assert.equal(result.failed, true);
    assert.equal(result.output.includes(credential), false, 'Rejected connection credentials must not reach diagnostics.');
    assert.equal(connections, 0);
  }
  try {
    await denied(process.execPath, ['--experimental-strip-types', 'scripts/local-next.ts', 'build']);
    await denied(process.execPath, ['--experimental-strip-types', 'src/db/seed.ts']);
    await denied(process.execPath, ['--experimental-strip-types', 'scripts/backfill-unicode-song-search.ts']);
    await denied(process.execPath, ['--experimental-strip-types', 'src/server/platform-admin/import-worker-process.ts', '--once']);
    if (process.platform === 'win32') {
      await denied(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'node_modules\\.bin\\drizzle-kit.cmd migrate']);
    } else {
      await denied(process.execPath, ['node_modules/drizzle-kit/bin.cjs', 'migrate']);
    }
    await denied(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
      'import { createLocalSupabaseFixture } from "./tests/e2e/local-supabase-fixture.ts"; await createLocalSupabaseFixture();']);
  } finally { await new Promise<void>(resolve => listener.close(() => resolve())); }
});
