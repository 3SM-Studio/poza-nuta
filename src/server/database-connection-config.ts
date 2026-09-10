const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const SUPABASE_TRANSACTION_POOLER_PORT = "6543";

type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

export class DatabaseConfigurationError extends Error {
  readonly code: "DATABASE_URL_MISSING" | "DATABASE_CONNECTION_MODE_INVALID";

  constructor(
    code: DatabaseConfigurationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "DatabaseConfigurationError";
    this.code = code;
  }
}

export function requireRuntimeDatabaseUrl(
  environment: DatabaseEnvironment = process.env,
) {
  const databaseUrl = environment.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new DatabaseConfigurationError(
      "DATABASE_URL_MISSING",
      "DATABASE_URL is not configured.",
    );
  }

  if (environment.VERCEL === "1" && !isSupabaseTransactionPoolerUrl(databaseUrl)) {
    throw new DatabaseConfigurationError(
      "DATABASE_CONNECTION_MODE_INVALID",
      "DATABASE_URL must use the Supabase transaction pooler in Vercel runtime.",
    );
  }

  return databaseUrl;
}

export function isSupabaseTransactionPoolerUrl(value: string) {
  try {
    const url = new URL(value);
    const isSupabaseHost =
      url.hostname.endsWith(".pooler.supabase.com") ||
      (url.hostname.startsWith("db.") && url.hostname.endsWith(".supabase.co"));

    return (
      POSTGRES_PROTOCOLS.has(url.protocol) &&
      isSupabaseHost &&
      url.port === SUPABASE_TRANSACTION_POOLER_PORT
    );
  } catch {
    return false;
  }
}
