type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

export function requireAdminDatabaseUrl(
  environment: DatabaseEnvironment = process.env,
) {
  const databaseUrl = environment.DIRECT_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "DIRECT_URL is not configured for migrations or database administration.",
    );
  }

  return databaseUrl;
}
