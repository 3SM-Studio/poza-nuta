export function assertLocalCatalogFixtureTarget(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname)) {
    throw new Error(
      "Catalog fixtures may only be written to a local development database.",
    );
  }
}
