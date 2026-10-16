import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { assertLocalApiTarget, assertLocalDatabaseTarget } from '../src/lib/local-target.ts';

const permitted: Record<string, readonly string[]> = {
  '.env.local': ['KUNESTU_LOCAL', 'DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_URL', 'SITE_URL'],
  '.env.admin.local': ['KUNESTU_LOCAL', 'DIRECT_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'OPERATOR_BOOTSTRAP_PIN', 'OPERATOR_BOOTSTRAP_NAME'],
  '.env.auth.local': ['AUTH_INVITE_COOKIE_SECRET', 'PLATFORM_SETUP_TOKEN_SHA256'],
  '.env.worker.local': ['IMPORT_WORKER_DATABASE_URL', 'ISING_API_BASE_URL', 'ISING_CLIENT_ID'],
};

// Next/Vite load dotenv fallbacks themselves. Refuse unowned fallback files before launch.
export function assertNoCloudEnvironmentFiles(root = process.cwd()) {
  for (const file of readdirSync(root).filter(name => /^\.env(?:\.|$)/.test(name) && name !== '.env.example')) {
    const allowed = permitted[file];
    if (!allowed) throw new Error('Unmanaged dotenv fallback file blocks local development/tests. Quarantine it explicitly.');
    const text = readFileSync(join(root, file), 'utf8');
    if (!text.startsWith('# Owned local Supabase only.') || text.includes('qwmimnhdnzqfckswxjww')) {
      throw new Error('Cloud or unmanaged environment configuration blocks local development/tests.');
    }
    const values = parse(text);
    if (Object.keys(values).some(key => !allowed.includes(key))) throw new Error('Environment contains variables outside its local role.');
    for (const key of ['DATABASE_URL', 'DIRECT_URL', 'IMPORT_WORKER_DATABASE_URL']) {
      if (values[key] && new URL(assertLocalDatabaseTarget(values[key])).port !== '55522') {
        throw new Error('Root local configuration must address the persistent development stack.');
      }
    }
    for (const key of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
      if (values[key]) {
        assertLocalApiTarget(values[key]);
        if (new URL(values[key]).port !== '55521') throw new Error('Root Auth configuration must address the development stack.');
      }
    }
    if (values.SITE_URL && values.SITE_URL !== 'http://localhost:3000') throw new Error('Unknown local Site URL.');
  }
}
