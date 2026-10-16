// Pure validation: call before constructing clients for local tools and tests.
const registry = globalThis as typeof globalThis & { pozaNutaTestPorts?: Set<number> };

export function registerPostgresTestPort(port: number) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid test port.");
  (registry.pozaNutaTestPorts ??= new Set()).add(port);
}

export function unregisterPostgresTestPort(port: number) {
  registry.pozaNutaTestPorts?.delete(port);
}

export function assertLocalDatabaseTarget(value: string | undefined) {
  const url = parseTarget(value);
  const safeParameters = [...url.searchParams].every(([key, parameter]) =>
    key === 'application_name' && /^[a-z0-9_-]{1,64}$/i.test(parameter));
  const knownSupabasePort = [55522, 55432].includes(Number(url.port));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' ||
      !(knownSupabasePort || registry.pozaNutaTestPorts?.has(Number(url.port))) ||
      (knownSupabasePort && url.pathname !== '/postgres') ||
      !/^\/[a-z0-9_]+$/.test(url.pathname) || !safeParameters || url.hash) {
    throw new Error("Blocked database target: an owned local PostgreSQL fixture is required.");
  }
  return value!.trim();
}

export function assertLocalApiTarget(value: string | undefined, databaseUrl?: string) {
  const url = parseTarget(value);
  const expectedPort = databaseUrl ? (new URL(assertLocalDatabaseTarget(databaseUrl)).port === '55522' ? '55521' : '55431') : null;
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      !['55521', '55431'].includes(url.port) || (expectedPort && url.port !== expectedPort) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error("Blocked Auth/Realtime target: a matching local Supabase API is required.");
  }
}

export function assertLocalE2ETarget(environment: Readonly<Record<string, string | undefined>>) {
  const db = assertLocalDatabaseTarget(environment.LOCAL_E2E_DATABASE_URL);
  if (new URL(db).port !== '55432' || environment.E2E_BASE_URL !== 'http://localhost:3105') {
    throw new Error("E2E requires the dedicated disposable local stack and application port.");
  }
  assertLocalApiTarget(environment.NEXT_PUBLIC_SUPABASE_URL, db);
  if (environment.SUPABASE_URL !== environment.NEXT_PUBLIC_SUPABASE_URL ||
      environment.DATABASE_URL !== db || environment.DIRECT_URL !== db) {
    throw new Error("E2E environment contains inconsistent targets.");
  }
}

function parseTarget(value: string | undefined) {
  try {
    if (!value || /qwmimnhdnzqfckswxjww/i.test(value)) throw new Error();
    return new URL(value.trim());
  } catch {
    throw new Error("Blocked target: missing or unrecognized local configuration.");
  }
}
