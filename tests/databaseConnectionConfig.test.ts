import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { requireAdminDatabaseUrl } from "../src/db/admin-database-url.ts";
import { getErrorMessage } from "../src/db/log-db-error.ts";
import {
  DatabaseConfigurationError,
  isSupabaseTransactionPoolerUrl,
  requireRuntimeDatabaseUrl,
} from "../src/server/database-connection-config.ts";

const transactionPoolerUrl =
  "postgresql://postgres.example:password@aws-0-eu.pooler.supabase.com:6543/postgres";
const sessionPoolerUrl =
  "postgresql://postgres.example:password@aws-0-eu.pooler.supabase.com:5432/postgres";

test("Vercel runtime requires the Supabase transaction pooler", () => {
  assert.equal(
    requireRuntimeDatabaseUrl({
      DATABASE_URL: transactionPoolerUrl,
      VERCEL: "1",
    }),
    transactionPoolerUrl,
  );
  assert.equal(isSupabaseTransactionPoolerUrl(transactionPoolerUrl), true);
  assert.equal(isSupabaseTransactionPoolerUrl(sessionPoolerUrl), false);
  assert.equal(
    isSupabaseTransactionPoolerUrl(
      "postgresql://postgres:password@db.example.supabase.co:6543/postgres",
    ),
    true,
  );
});

test("Vercel runtime rejects session and direct connection modes safely", () => {
  for (const databaseUrl of [
    sessionPoolerUrl,
    "postgresql://postgres:password@db.example.supabase.co:5432/postgres",
    "not-a-database-url-with-a-secret",
  ]) {
    assert.throws(
      () =>
        requireRuntimeDatabaseUrl({
          DATABASE_URL: databaseUrl,
          VERCEL: "1",
        }),
      (error: unknown) => {
        assert.ok(error instanceof DatabaseConfigurationError);
        assert.equal(
          error.code,
          "DATABASE_CONNECTION_MODE_INVALID",
        );
        assert.equal(error.message.includes(databaseUrl), false);
        return true;
      },
    );
  }
});

test("local runtime remains compatible with direct development databases", () => {
  assert.equal(
    requireRuntimeDatabaseUrl({ DATABASE_URL: sessionPoolerUrl }),
    sessionPoolerUrl,
  );
});

test("database administration uses a dedicated connection variable", () => {
  assert.equal(
    requireAdminDatabaseUrl({ DIRECT_URL: sessionPoolerUrl }),
    sessionPoolerUrl,
  );
  assert.throws(
    () => requireAdminDatabaseUrl({ DATABASE_URL: transactionPoolerUrl }),
    /DIRECT_URL is not configured/,
  );
});

test("runtime database client is lazy and shared within one isolate", () => {
  const source = readFileSync("src/server/db.ts", "utf8");

  assert.match(source, /globalThis as typeof globalThis/);
  assert.match(source, /pozaNutaDatabase \?\?= createDatabase\(\)/);
  assert.equal((source.match(/postgres\(databaseUrl/g) ?? []).length, 1);
});

test("database administration logs redact every connection variable", () => {
  const message = getErrorMessage(
    new Error(
      "DIRECT_URL=secret IMPORT_WORKER_DATABASE_URL=worker-secret DATABASE_URL=runtime-secret",
    ),
  );

  assert.equal(message.includes("worker-secret"), false);
  assert.equal(message.includes("runtime-secret"), false);
  assert.equal(message.includes("secret"), false);
});
