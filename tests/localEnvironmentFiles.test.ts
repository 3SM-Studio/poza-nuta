import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { assertNoCloudEnvironmentFiles } from '../scripts/local-environment-files.ts';

test('unmanaged dotenv fallbacks and mixed roles are blocked before a framework can load them', () => {
  const root = mkdtempSync(join(tmpdir(), 'kunestu-env-negative-'));
  try {
    assert.doesNotThrow(() => assertNoCloudEnvironmentFiles(root));
    for (const filename of ['.env', '.env.test', '.env.development.local', '.env.production.local']) {
      writeFileSync(join(root, filename), 'DATABASE_URL=synthetic-untrusted-value');
      assert.throws(() => assertNoCloudEnvironmentFiles(root), /Unmanaged dotenv/);
      rmSync(join(root, filename));
    }
    const local = join(root, '.env.local');
    writeFileSync(local, 'DATABASE_URL=synthetic-untrusted-value');
    assert.throws(() => assertNoCloudEnvironmentFiles(root), /unmanaged/);
    const prefix = '# Owned local Supabase only.\n';
    writeFileSync(local, prefix + 'DATABASE_URL=postgres://127.0.0.1:55522/postgres\n');
    assert.doesNotThrow(() => assertNoCloudEnvironmentFiles(root));
    writeFileSync(local, prefix + 'DATABASE_URL=postgres://127.0.0.1:55522/postgres\nSUPABASE_SECRET_KEY=synthetic-admin\n');
    assert.throws(() => assertNoCloudEnvironmentFiles(root), /outside its local role/);
    writeFileSync(local, prefix + 'NEXT_PUBLIC_SUPABASE_URL=https://qwmimnhdnzqfckswxjww.supabase.co\n');
    assert.throws(() => assertNoCloudEnvironmentFiles(root), /Cloud or unmanaged/);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    assert.ok(root.includes('kunestu-env-negative-'));
    rmSync(root, { recursive: true });
  }
});
