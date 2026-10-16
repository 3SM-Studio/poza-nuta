import { randomBytes } from 'node:crypto';
import { assertLocalApiTarget, assertLocalDatabaseTarget } from '../src/lib/local-target.ts';

// Never inherit application, cloud, Auth or E2E credentials.
export function cleanToolEnvironment(parent: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const allowed = /^(path|pathext|systemroot|windir|comspec|temp|tmp|userprofile|appdata|localappdata|programdata|home|lang|term|ci|npm_config_cache|pnpm_home)$/i;
  return { NODE_ENV: 'test', ...Object.fromEntries(Object.entries(parent).filter(([name]) => allowed.test(name))) };
}

export function localApplicationEnvironment(parent: Readonly<Record<string, string | undefined>>, input: {
  databaseUrl: string; apiUrl: string; publishableKey: string; secretKey: string; origin: string;
}) {
  const databaseUrl = assertLocalDatabaseTarget(input.databaseUrl);
  assertLocalApiTarget(input.apiUrl, databaseUrl);
  const origin = new URL(databaseUrl).port === '55522' ? 'http://localhost:3000' : 'http://localhost:3105';
  if (input.origin !== origin) throw new Error('Local application origin mismatch.');
  return {
    ...cleanToolEnvironment(parent),
    NODE_ENV: 'development' as const,
    KUNESTU_LOCAL: '1',
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    IMPORT_WORKER_DATABASE_URL: '',
    NEXT_PUBLIC_SUPABASE_URL: input.apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: input.publishableKey,
    SUPABASE_URL: input.apiUrl,
    SUPABASE_SECRET_KEY: input.secretKey,
    SUPABASE_SERVICE_ROLE_KEY: '',
    // Setup stays disabled until a separate local bootstrap token is requested.
    PLATFORM_SETUP_TOKEN_SHA256: '',
    AUTH_INVITE_COOKIE_SECRET: randomBytes(32).toString('base64url'),
    OPERATOR_BOOTSTRAP_PIN: randomBytes(24).toString('base64url'),
    OPERATOR_BOOTSTRAP_NAME: 'Synthetic local operator',
    API_ADMIN_TOKEN: '',
    ISING_CLIENT_ID: '',
    ISING_API_BASE_URL: 'http://127.0.0.1:55525',
    SITE_URL: origin,
  };
}
