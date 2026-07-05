import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";
import { databaseClientOptions } from "./db-client-options";

function createDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Set it before using the database.",
    );
  }

  const client = postgres(databaseUrl, databaseClientOptions);

  return drizzle({ client, schema });
}

type Database = ReturnType<typeof createDatabase>;

const globalForDatabase = globalThis as typeof globalThis & {
  pozaNutaDatabase?: Database;
};

export function getDb(): Database {
  globalForDatabase.pozaNutaDatabase ??= createDatabase();

  return globalForDatabase.pozaNutaDatabase;
}
