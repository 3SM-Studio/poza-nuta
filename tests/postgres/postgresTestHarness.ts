import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

import postgres from "postgres";

const execFileAsync = promisify(execFile);
const migrationJournalPath = "drizzle/meta/_journal.json";
const commandTimeoutMs = 120_000;

export const POSTGRES_TEST_IMAGE = "postgres:15-alpine";

export type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export type PostgresTestHarness = {
  containerName: string;
  host: string;
  port: number;
  password: string;
};

type Journal = {
  entries: Array<{ idx: number; tag: string }>;
};

const compatibilityFixture = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY
);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT NULL::uuid $$;

CREATE SCHEMA IF NOT EXISTS realtime;
CREATE TABLE IF NOT EXISTS realtime.messages (
  extension text NOT NULL DEFAULT 'broadcast'
);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION realtime.topic()
RETURNS text
LANGUAGE sql
STABLE
AS $$ SELECT ''::text $$;
CREATE OR REPLACE FUNCTION realtime.send(
  payload jsonb,
  event_name text,
  topic_name text,
  private_channel boolean
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN;
END;
$$;
`;

export async function startPostgresTestHarness(
  namePrefix: string,
): Promise<PostgresTestHarness> {
  assert.match(namePrefix, /^[a-z0-9-]+$/);
  const containerName = `${namePrefix}-${randomUUID()}`;
  const passwordBytes = randomBytes(32);
  const password = passwordBytes.toString("base64url");
  passwordBytes.fill(0);
  const environment = dockerEnvironment(password);

  await docker(
    [
      "run",
      "-d",
      "--name",
      containerName,
      "--pull",
      "missing",
      "--env",
      "POSTGRES_PASSWORD",
      "--env",
      "POSTGRES_USER=postgres",
      "--env",
      "POSTGRES_DB=postgres",
      "--publish",
      "127.0.0.1::5432",
      "--health-cmd",
      "pg_isready -U postgres -d postgres",
      "--health-interval",
      "1s",
      "--health-timeout",
      "3s",
      "--health-retries",
      "60",
      POSTGRES_TEST_IMAGE,
    ],
    environment,
  );

  try {
    await waitForHealthy(containerName);
    const portOutput = await docker(["port", containerName, "5432/tcp"]);
    const portMatch = portOutput.match(/127\.0\.0\.1:(\d+)/);
    assert.ok(portMatch, "Docker did not publish PostgreSQL on 127.0.0.1");

    return {
      containerName,
      host: "127.0.0.1",
      port: Number(portMatch[1]),
      password,
    };
  } catch (error) {
    await removePostgresTestHarness(containerName);
    throw error;
  }
}

export async function removePostgresTestHarness(
  containerName: string,
): Promise<void> {
  try {
    await docker(["rm", "--force", containerName]);
  } catch (error) {
    if (await postgresTestContainerExists(containerName)) {
      throw error;
    }
  }
}

export async function postgresTestContainerExists(
  containerName: string,
): Promise<boolean> {
  try {
    await docker(["inspect", containerName]);
    return true;
  } catch {
    return false;
  }
}

export function createPostgresTestClient(
  harness: PostgresTestHarness,
  database: string,
  maximumConnections = 2,
): postgres.Sql {
  return postgres({
    host: harness.host,
    port: harness.port,
    database,
    user: "postgres",
    password: harness.password,
    max: maximumConnections,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
    onnotice: () => undefined,
  });
}

export async function installPostgresCompatibilityFixture(
  sql: postgres.Sql,
): Promise<void> {
  await sql.unsafe('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
  await sql.unsafe(compatibilityFixture);
}

export async function applyPostgresMigrations(
  sql: postgres.Sql,
  throughIndex: number,
): Promise<void> {
  const journal = JSON.parse(
    readFileSync(migrationJournalPath, "utf8"),
  ) as Journal;

  for (const entry of journal.entries.filter(
    ({ idx }) => idx <= throughIndex,
  )) {
    await applyMigrationEntry(sql, entry.tag);
  }
}

export async function applyPostgresMigration(
  sql: postgres.Sql,
  index: number,
): Promise<void> {
  const journal = JSON.parse(
    readFileSync(migrationJournalPath, "utf8"),
  ) as Journal;
  const entry = journal.entries.find(({ idx }) => idx === index);
  assert.ok(entry, `Migration ${index} is missing from the journal`);
  await applyMigrationEntry(sql, entry.tag);
}

export async function createPostgresDatabase(
  admin: postgres.Sql,
  database: string,
  template?: string,
): Promise<void> {
  assert.match(database, /^[a-z0-9_]+$/);
  if (template) assert.match(template, /^[a-z0-9_]+$/);
  await admin.unsafe(
    `CREATE DATABASE "${database}"${template ? ` TEMPLATE "${template}"` : ""}`,
  );
}

export async function dropPostgresDatabase(
  admin: postgres.Sql,
  database: string,
): Promise<void> {
  assert.match(database, /^[a-z0-9_]+$/);
  await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
}

export async function withBlankPostgresDatabase(
  harness: PostgresTestHarness,
  admin: postgres.Sql,
  prefix: string,
  callback: (sql: postgres.Sql, database: string) => Promise<void>,
): Promise<void> {
  const database = postgresDatabaseName(prefix);
  await createPostgresDatabase(admin, database);
  const sql = createPostgresTestClient(harness, database);

  try {
    await callback(sql, database);
  } finally {
    await sql.end({ timeout: 5 });
    await dropPostgresDatabase(admin, database);
  }
}

export async function withPostgresClone(
  harness: PostgresTestHarness,
  admin: postgres.Sql,
  template: string,
  prefix: string,
  callback: (sql: postgres.Sql, database: string) => Promise<void>,
): Promise<void> {
  const database = postgresDatabaseName(prefix);
  await createPostgresDatabase(admin, database, template);
  const sql = createPostgresTestClient(harness, database);

  try {
    await callback(sql, database);
  } finally {
    await sql.end({ timeout: 5 });
    await dropPostgresDatabase(admin, database);
  }
}

export function postgresDatabaseName(prefix: string): string {
  assert.match(prefix, /^[a-z0-9_]+$/);
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function applyMigrationEntry(
  sql: postgres.Sql,
  tag: string,
): Promise<void> {
  const migration = readFileSync(`drizzle/${tag}.sql`, "utf8");
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  await sql.begin(async (transaction) => {
    for (const statement of statements) {
      await transaction.unsafe(statement);
    }
  });
}

async function waitForHealthy(containerName: string): Promise<void> {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const status = await docker([
      "inspect",
      "--format",
      "{{.State.Health.Status}}",
      containerName,
    ]);

    if (status === "healthy") return;
    if (status === "unhealthy") {
      throw new Error("Isolated PostgreSQL container became unhealthy");
    }

    await delay(500);
  }

  throw new Error("Timed out waiting for isolated PostgreSQL container");
}

async function docker(
  args: string[],
  env: NodeJS.ProcessEnv = dockerEnvironment(),
): Promise<string> {
  const { stdout } = await execFileAsync("docker", args, {
    cwd: process.cwd(),
    env,
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  return stdout.trim();
}

function dockerEnvironment(password?: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    Path: process.env.Path,
    PATHEXT: process.env.PATHEXT,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    ComSpec: process.env.ComSpec,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    ProgramData: process.env.ProgramData,
    ...(password ? { POSTGRES_PASSWORD: password } : {}),
  };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
