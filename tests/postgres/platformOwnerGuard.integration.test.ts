import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const image = "postgres:15-alpine";
const migrationJournalPath = "drizzle/meta/_journal.json";
const guardConstraint = "eligible_platform_owner_required";
const commandTimeoutMs = 120_000;
const transactionTimeoutMs = 20_000;

type SqlExecutor = postgres.Sql | postgres.TransactionSql;
type Owner = { operatorId: number; membershipId: number };
type Reduction =
  | "suspend"
  | "demote"
  | "deactivateOperator"
  | "deactivateMembership"
  | "deleteMembership"
  | "deleteOperator";
type Isolation = "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";
type PgFailure = Error & { code?: string; constraint_name?: string };

type Harness = {
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

test(
  "platform owner guard preserves at least one eligible owner",
  { timeout: 600_000 },
  async (t) => {
    const harness = await startHarness();
    let templateDatabase = "";

    try {
      const admin = createClient(harness, "postgres");

      try {
        templateDatabase = databaseName("owner_guard_template");
        await createDatabase(admin, templateDatabase);

        await t.test("full migrations leave the legacy workspace unarmed", async () => {
          const sql = createClient(harness, templateDatabase);

          try {
            await installCompatibilityFixture(sql);
            await applyMigrations(sql, 15);

            const state = await guardState(sql);
            assert.deepEqual(state, { armed: false, rowCount: 1 });
            assert.equal(await eligibleOwnerCount(sql), 0);
            assert.equal(await tableCount(sql, "operator_users"), 0);
            assert.equal(await tableCount(sql, "platform_members"), 0);
            assert.equal(await tableCount(sql, "workspace_members"), 0);
            assert.equal(await tableCount(sql, "events"), 0);

            const workspaces = await sql.unsafe(
              'SELECT "name", "handle" FROM "public"."workspaces"',
            );
            assert.equal(workspaces.length, 1);
            assert.equal(workspaces[0]?.name, "Poza Nutą");
            assert.equal(workspaces[0]?.handle, "pozanuta");

            const functions = await sql.unsafe(`
              SELECT "proname", "prosecdef", "provolatile", "proconfig"
              FROM "pg_proc"
              INNER JOIN "pg_namespace" ON "pg_namespace"."oid" = "pg_proc"."pronamespace"
              WHERE "pg_namespace"."nspname" = 'private'
                AND "pg_proc"."proname" IN (
                  'serialize_platform_owner_transition',
                  'validate_and_arm_platform_owner_guard',
                  'protect_platform_owner_guard'
                )
              ORDER BY "proname"
            `);
            assert.equal(functions.length, 3);
            for (const guardFunction of functions) {
              assert.equal(guardFunction.prosecdef, true);
              assert.equal(guardFunction.provolatile, "v");
              assert.deepEqual(guardFunction.proconfig, ['search_path=""']);
            }

            const triggers = await sql.unsafe(`
              SELECT "tgname", "tgenabled"
              FROM "pg_trigger"
              WHERE NOT "tgisinternal"
                AND "tgname" LIKE '%platform_owner_guard%'
              ORDER BY "tgname"
            `);
            assert.equal(triggers.length, 8);
            assert.ok(triggers.every(({ tgenabled }) => tgenabled === "O"));

            const tablePrivileges = await sql.unsafe(`
              SELECT
                "role_name",
                "privilege_name",
                has_table_privilege(
                  "role_name",
                  'private.platform_owner_guard',
                  "privilege_name"
                ) AS "allowed"
              FROM (VALUES ('anon'), ('authenticated')) AS "roles"("role_name")
              CROSS JOIN (
                VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')
              ) AS "privileges"("privilege_name")
              ORDER BY "role_name", "privilege_name"
            `);
            assert.equal(tablePrivileges.length, 10);
            assert.ok(tablePrivileges.every(({ allowed }) => allowed === false));

            const functionPrivileges = await sql.unsafe(`
              SELECT
                "role_name",
                "function_signature",
                has_function_privilege(
                  "role_name",
                  "function_signature",
                  'EXECUTE'
                ) AS "allowed"
              FROM (VALUES ('anon'), ('authenticated')) AS "roles"("role_name")
              CROSS JOIN (
                VALUES
                  ('private.serialize_platform_owner_transition()'),
                  ('private.validate_and_arm_platform_owner_guard()'),
                  ('private.protect_platform_owner_guard()')
              ) AS "functions"("function_signature")
              ORDER BY "role_name", "function_signature"
            `);
            assert.equal(functionPrivileges.length, 6);
            assert.ok(
              functionPrivileges.every(({ allowed }) => allowed === false),
            );
          } finally {
            await sql.end({ timeout: 5 });
          }
        });

        await t.test("initialized migration arms the guard", async () => {
          await withBlankDatabase(harness, admin, async (sql) => {
            await installCompatibilityFixture(sql);
            await applyMigrations(sql, 14);
            await seedOwner(sql, "initialized");
            await applyMigration(sql, 15);

            assert.deepEqual(await guardState(sql), {
              armed: true,
              rowCount: 1,
            });
            assert.equal(await eligibleOwnerCount(sql), 1);
          });
        });

        await t.test(
          "inconsistent migration fails without partial installation",
          async () => {
            await withBlankDatabase(harness, admin, async (sql) => {
              await installCompatibilityFixture(sql);
              await applyMigrations(sql, 14);
              await insertOperator(sql, "inconsistent");

              await expectGuardError(applyMigration(sql, 15));

              const relation = await sql.unsafe(
                "SELECT to_regclass('private.platform_owner_guard') AS relation",
              );
              assert.equal(relation[0]?.relation, null);
            });
          },
        );

        await t.test("first setup arms and rollback restores unarmed state", async () => {
          await withClone(harness, admin, templateDatabase, async (sql) => {
            await sql.begin(async (tx) => {
              const operatorId = await insertOperator(tx, "first_setup");
              await insertOwnerMembership(tx, operatorId);
            });

            assert.deepEqual(await guardState(sql), {
              armed: true,
              rowCount: 1,
            });
            assert.equal(await eligibleOwnerCount(sql), 1);
          });

          await withClone(harness, admin, templateDatabase, async (sql) => {
            const rollback = new Error("intentional setup rollback");
            await assert.rejects(
              sql.begin(async (tx) => {
                const operatorId = await insertOperator(tx, "rolled_back_setup");
                await insertOwnerMembership(tx, operatorId);
                throw rollback;
              }),
              rollback,
            );

            assert.deepEqual(await guardState(sql), {
              armed: false,
              rowCount: 1,
            });
            assert.equal(await tableCount(sql, "operator_users"), 0);
            assert.equal(await tableCount(sql, "platform_members"), 0);
          });
        });

        await t.test("support and admin cannot precede the first owner", async () => {
          for (const role of ["support", "platform_admin"] as const) {
            await withClone(harness, admin, templateDatabase, async (sql) => {
              const operatorId = await insertOperator(sql, `pre_owner_${role}`);
              await expectGuardError(
                sql.unsafe(
                  'INSERT INTO "public"."platform_members" ("operator_user_id", "role") VALUES ($1, $2)',
                  [operatorId, role],
                ),
              );

              assert.equal(await tableCount(sql, "platform_members"), 0);
              assert.deepEqual(await guardState(sql), {
                armed: false,
                rowCount: 1,
              });
            });
          }
        });

        const lastOwnerCases: Array<[string, Reduction]> = [
          ["suspension", "suspend"],
          ["operator deactivation", "deactivateOperator"],
          ["membership deactivation", "deactivateMembership"],
          ["demotion", "demote"],
          ["membership delete", "deleteMembership"],
          ["operator cascade delete", "deleteOperator"],
        ];

        for (const [label, reduction] of lastOwnerCases) {
          await t.test(`last owner rejects ${label}`, async () => {
            await withClone(harness, admin, templateDatabase, async (sql) => {
              const [owner] = await seedOwners(sql, 1, `last_${reduction}`);
              await expectGuardError(reduceOwner(sql, owner, reduction));

              assert.equal(await eligibleOwnerCount(sql), 1);
              assert.equal(await ownerIsEligible(sql, owner), true);
            });
          });
        }

        const concurrencyCases: Array<[
          string,
          Reduction,
          Reduction,
          Isolation,
        ]> = [
          ["suspension plus suspension", "suspend", "suspend", "READ COMMITTED"],
          ["demotion plus demotion", "demote", "demote", "READ COMMITTED"],
          ["suspension plus demotion", "suspend", "demote", "READ COMMITTED"],
          [
            "delete plus deactivation",
            "deleteOperator",
            "deactivateMembership",
            "READ COMMITTED",
          ],
          [
            "repeatable read reductions",
            "suspend",
            "suspend",
            "REPEATABLE READ",
          ],
          ["serializable reductions", "suspend", "suspend", "SERIALIZABLE"],
        ];

        for (const [label, left, right, isolation] of concurrencyCases) {
          await t.test(`concurrent ${label}`, async (t) => {
            await withClone(harness, admin, templateDatabase, async (sql, db) => {
              const owners = await seedOwners(sql, 2, `concurrent_${label}`);
              const result = await runConcurrentReductions(
                harness,
                db,
                owners[0],
                left,
                owners[1],
                right,
                isolation,
              );

              assert.equal(result.left.status, "fulfilled");
              const failure = assertConcurrencyFailure(result.right, isolation);
              t.diagnostic(failure.code ?? "missing SQLSTATE");
              assert.equal(await eligibleOwnerCount(sql), 1);
              assert.equal(await ownerIsEligible(sql, owners[0]), false);
              assert.equal(await ownerIsEligible(sql, owners[1]), true);
            });
          });
        }

        await t.test("concurrent replacement never exposes zero owners", async () => {
          await withClone(harness, admin, templateDatabase, async (sql, db) => {
            const [existing] = await seedOwners(sql, 1, "replacement_existing");
            const added = deferred<void>();
            const release = deferred<void>();
            const addClient = createClient(harness, db);
            const removeClient = createClient(harness, db);

            try {
              const addPromise = addClient.begin(async (tx) => {
                const operatorId = await insertOperator(tx, "replacement_new");
                await insertOwnerMembership(tx, operatorId);
                added.resolve();
                await release.promise;
              });

              await within(added.promise, transactionTimeoutMs);
              const removeSettled = removeClient
                .begin(async (tx) => reduceOwner(tx, existing, "deleteMembership"))
                .then(
                  () => ({ status: "fulfilled" as const }),
                  (reason: unknown) => ({ status: "rejected" as const, reason }),
                );

              await delay(150);
              release.resolve();
              await within(addPromise, transactionTimeoutMs);
              const removeResult = await within(
                removeSettled,
                transactionTimeoutMs,
              );

              if (removeResult.status === "rejected") {
                const failure = removeResult.reason as PgFailure;
                assert.equal(failure.code, "23514");
                assert.equal(failure.constraint_name, guardConstraint);
                await reduceOwner(sql, existing, "deleteMembership");
              }

              assert.equal(await eligibleOwnerCount(sql), 1);
            } finally {
              release.resolve();
              await Promise.all([
                addClient.end({ timeout: 5 }),
                removeClient.end({ timeout: 5 }),
              ]);
            }
          });
        });

        await t.test("two concurrent first owners both initialize safely", async () => {
          await withClone(harness, admin, templateDatabase, async (sql, db) => {
            const firstReady = deferred<void>();
            const releaseFirst = deferred<void>();
            const first = createClient(harness, db);
            const second = createClient(harness, db);

            try {
              const firstPromise = first.begin(async (tx) => {
                const operatorId = await insertOperator(tx, "first_concurrent");
                await insertOwnerMembership(tx, operatorId);
                firstReady.resolve();
                await releaseFirst.promise;
              });

              await within(firstReady.promise, transactionTimeoutMs);
              const secondPromise = second.begin(async (tx) => {
                const operatorId = await insertOperator(tx, "second_concurrent");
                await insertOwnerMembership(tx, operatorId);
              });

              await delay(150);
              releaseFirst.resolve();
              await within(
                Promise.all([firstPromise, secondPromise]),
                transactionTimeoutMs,
              );

              assert.equal(await eligibleOwnerCount(sql), 2);
              assert.deepEqual(await guardState(sql), {
                armed: true,
                rowCount: 1,
              });
            } finally {
              releaseFirst.resolve();
              await Promise.all([
                first.end({ timeout: 5 }),
                second.end({ timeout: 5 }),
              ]);
            }
          });
        });

        await t.test("multi-row and statement ordering preserve the invariant", async () => {
          await withClone(harness, admin, templateDatabase, async (sql) => {
            await seedOwners(sql, 2, "multi_row");
            await expectGuardError(
              sql.unsafe(
                'UPDATE "public"."platform_members" SET "active" = false WHERE "role" = \'platform_owner\'',
              ),
            );
            assert.equal(await eligibleOwnerCount(sql), 2);
          });

          await withClone(harness, admin, templateDatabase, async (sql) => {
            const [oldOwner] = await seedOwners(sql, 1, "ordered_old");

            await sql.begin(async (tx) => {
              const replacementId = await insertOperator(tx, "ordered_new");
              await insertOwnerMembership(tx, replacementId);
              await reduceOwner(tx, oldOwner, "deleteMembership");
            });

            assert.equal(await eligibleOwnerCount(sql), 1);
          });

          await withClone(harness, admin, templateDatabase, async (sql) => {
            const [oldOwner] = await seedOwners(sql, 1, "reverse_old");

            await expectGuardError(
              sql.begin(async (tx) => {
                await reduceOwner(tx, oldOwner, "deleteMembership");
                const replacementId = await insertOperator(tx, "reverse_new");
                await insertOwnerMembership(tx, replacementId);
              }),
            );

            assert.equal(await eligibleOwnerCount(sql), 1);
            assert.equal(await tableCount(sql, "operator_users"), 1);
          });
        });

        await t.test("guard table and truncates are protected", async () => {
          await withClone(harness, admin, templateDatabase, async (sql) => {
            await seedOwners(sql, 1, "guard_protection");

            const forbidden = [
              'DELETE FROM "private"."platform_owner_guard"',
              'TRUNCATE TABLE "private"."platform_owner_guard"',
              'UPDATE "private"."platform_owner_guard" SET "armed" = false',
              'UPDATE "private"."platform_owner_guard" SET "revision" = "revision" - 1',
              'TRUNCATE TABLE "public"."operator_users" CASCADE',
              'TRUNCATE TABLE "public"."platform_members"',
            ];

            for (const statement of forbidden) {
              await expectGuardError(sql.unsafe(statement));
            }

            assert.equal(await eligibleOwnerCount(sql), 1);
            assert.deepEqual(await guardState(sql), {
              armed: true,
              rowCount: 1,
            });
          });
        });

        await t.test("missing singleton fails closed", async () => {
          await withClone(harness, admin, templateDatabase, async (sql) => {
            const [owner] = await seedOwners(sql, 1, "missing_singleton");

            await sql.unsafe(
              'ALTER TABLE "private"."platform_owner_guard" DISABLE TRIGGER "a_platform_owner_guard_protect"',
            );
            await sql.unsafe('DELETE FROM "private"."platform_owner_guard"');
            await sql.unsafe(
              'ALTER TABLE "private"."platform_owner_guard" ENABLE TRIGGER "a_platform_owner_guard_protect"',
            );

            await expectGuardError(
              sql.unsafe(
                'UPDATE "public"."operator_users" SET "active" = "active" WHERE "id" = $1',
                [owner.operatorId],
              ),
            );
            assert.deepEqual(await guardState(sql), {
              armed: false,
              rowCount: 0,
            });
          });
        });
      } finally {
        if (templateDatabase) {
          await dropDatabase(admin, templateDatabase);
        }
        await admin.end({ timeout: 5 });
      }
    } finally {
      harness.password = "";
      await removeHarness(harness.containerName);
      assert.equal(await containerExists(harness.containerName), false);
    }
  },
);

async function startHarness(): Promise<Harness> {
  const containerName = `pozanuta-owner-guard-${randomUUID()}`;
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
      image,
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
    await removeHarness(containerName);
    throw error;
  }
}

async function removeHarness(containerName: string): Promise<void> {
  try {
    await docker(["rm", "--force", containerName]);
  } catch (error) {
    if (await containerExists(containerName)) {
      throw error;
    }
  }
}

async function containerExists(containerName: string): Promise<boolean> {
  try {
    await docker(["inspect", containerName]);
    return true;
  } catch {
    return false;
  }
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

function createClient(harness: Harness, database: string): postgres.Sql {
  return postgres({
    host: harness.host,
    port: harness.port,
    database,
    user: "postgres",
    password: harness.password,
    max: 2,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
    onnotice: () => undefined,
  });
}

async function installCompatibilityFixture(sql: postgres.Sql): Promise<void> {
  await sql.unsafe('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
  await sql.unsafe(compatibilityFixture);
}

async function applyMigrations(
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

async function applyMigration(sql: postgres.Sql, index: number): Promise<void> {
  const journal = JSON.parse(
    readFileSync(migrationJournalPath, "utf8"),
  ) as Journal;
  const entry = journal.entries.find(({ idx }) => idx === index);
  assert.ok(entry, `Migration ${index} is missing from the journal`);
  await applyMigrationEntry(sql, entry.tag);
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

  await sql.begin(async (tx) => {
    for (const statement of statements) {
      await tx.unsafe(statement);
    }
  });
}

async function createDatabase(
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

async function dropDatabase(admin: postgres.Sql, database: string): Promise<void> {
  assert.match(database, /^[a-z0-9_]+$/);
  await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
}

async function withBlankDatabase(
  harness: Harness,
  admin: postgres.Sql,
  callback: (sql: postgres.Sql, database: string) => Promise<void>,
): Promise<void> {
  const database = databaseName("owner_guard_blank");
  await createDatabase(admin, database);
  const sql = createClient(harness, database);

  try {
    await callback(sql, database);
  } finally {
    await sql.end({ timeout: 5 });
    await dropDatabase(admin, database);
  }
}

async function withClone(
  harness: Harness,
  admin: postgres.Sql,
  template: string,
  callback: (sql: postgres.Sql, database: string) => Promise<void>,
): Promise<void> {
  const database = databaseName("owner_guard_case");
  await createDatabase(admin, database, template);
  const sql = createClient(harness, database);

  try {
    await callback(sql, database);
  } finally {
    await sql.end({ timeout: 5 });
    await dropDatabase(admin, database);
  }
}

function databaseName(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function insertOperator(
  sql: SqlExecutor,
  label: string,
): Promise<number> {
  const rows = await sql.unsafe(
    'INSERT INTO "public"."operator_users" ("name", "password_hash") VALUES ($1, $2) RETURNING "id"',
    [`test_${label}_${randomUUID()}`, "test-only-hash"],
  );
  const id = Number(rows[0]?.id);
  assert.ok(Number.isSafeInteger(id));
  return id;
}

async function insertOwnerMembership(
  sql: SqlExecutor,
  operatorId: number,
): Promise<number> {
  const rows = await sql.unsafe(
    'INSERT INTO "public"."platform_members" ("operator_user_id", "role") VALUES ($1, \'platform_owner\') RETURNING "id"',
    [operatorId],
  );
  const id = Number(rows[0]?.id);
  assert.ok(Number.isSafeInteger(id));
  return id;
}

async function seedOwner(sql: SqlExecutor, label: string): Promise<Owner> {
  const operatorId = await insertOperator(sql, label);
  const membershipId = await insertOwnerMembership(sql, operatorId);
  return { operatorId, membershipId };
}

async function seedOwners(
  sql: SqlExecutor,
  count: number,
  label: string,
): Promise<Owner[]> {
  const owners: Owner[] = [];
  for (let index = 0; index < count; index += 1) {
    owners.push(await seedOwner(sql, `${label}_${index}`));
  }
  return owners;
}

async function reduceOwner(
  sql: SqlExecutor,
  owner: Owner,
  reduction: Reduction,
): Promise<void> {
  switch (reduction) {
    case "suspend":
      await sql.unsafe(
        `UPDATE "public"."operator_users"
         SET "suspended_at" = now(),
             "suspension_reason" = 'isolated test',
             "suspended_by_operator_id" = $1
         WHERE "id" = $1`,
        [owner.operatorId],
      );
      return;
    case "demote":
      await sql.unsafe(
        'UPDATE "public"."platform_members" SET "role" = \'platform_admin\' WHERE "id" = $1',
        [owner.membershipId],
      );
      return;
    case "deactivateOperator":
      await sql.unsafe(
        'UPDATE "public"."operator_users" SET "active" = false WHERE "id" = $1',
        [owner.operatorId],
      );
      return;
    case "deactivateMembership":
      await sql.unsafe(
        'UPDATE "public"."platform_members" SET "active" = false WHERE "id" = $1',
        [owner.membershipId],
      );
      return;
    case "deleteMembership":
      await sql.unsafe(
        'DELETE FROM "public"."platform_members" WHERE "id" = $1',
        [owner.membershipId],
      );
      return;
    case "deleteOperator":
      await sql.unsafe(
        'DELETE FROM "public"."operator_users" WHERE "id" = $1',
        [owner.operatorId],
      );
  }
}

async function runConcurrentReductions(
  harness: Harness,
  database: string,
  leftOwner: Owner,
  leftReduction: Reduction,
  rightOwner: Owner,
  rightReduction: Reduction,
  isolation: Isolation,
): Promise<{
  left: PromiseSettledResult<void>;
  right: PromiseSettledResult<void>;
}> {
  const left = createClient(harness, database);
  const right = createClient(harness, database);
  const leftReady = deferred<void>();
  const releaseLeft = deferred<void>();

  try {
    const leftPromise = left.begin(async (tx) => {
      await setIsolation(tx, isolation);
      await reduceOwner(tx, leftOwner, leftReduction);
      leftReady.resolve();
      await releaseLeft.promise;
    });

    await within(leftReady.promise, transactionTimeoutMs);
    const rightPromise = right.begin(async (tx) => {
      await setIsolation(tx, isolation);
      await reduceOwner(tx, rightOwner, rightReduction);
    });
    const rightSettled = rightPromise.then(
      () => ({ status: "fulfilled" as const, value: undefined }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );

    await delay(150);
    releaseLeft.resolve();

    const leftSettled = leftPromise.then(
      () => ({ status: "fulfilled" as const, value: undefined }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );

    const [leftResult, rightResult] = await within(
      Promise.all([leftSettled, rightSettled]),
      transactionTimeoutMs,
    );
    return { left: leftResult, right: rightResult };
  } finally {
    releaseLeft.resolve();
    await Promise.all([left.end({ timeout: 5 }), right.end({ timeout: 5 })]);
  }
}

async function setIsolation(
  sql: postgres.TransactionSql,
  isolation: Isolation,
): Promise<void> {
  await sql.unsafe(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
}

async function eligibleOwnerCount(sql: SqlExecutor): Promise<number> {
  const rows = await sql.unsafe(`
    SELECT count(*) AS count
    FROM "public"."platform_members"
    INNER JOIN "public"."operator_users"
      ON "operator_users"."id" = "platform_members"."operator_user_id"
    WHERE "operator_users"."active" = true
      AND "operator_users"."suspended_at" IS NULL
      AND "platform_members"."active" = true
      AND "platform_members"."role" = 'platform_owner'
  `);
  return Number(rows[0]?.count);
}

async function ownerIsEligible(
  sql: SqlExecutor,
  owner: Owner,
): Promise<boolean> {
  const rows = await sql.unsafe(
    `SELECT EXISTS (
       SELECT 1
       FROM "public"."platform_members"
       INNER JOIN "public"."operator_users"
         ON "operator_users"."id" = "platform_members"."operator_user_id"
       WHERE "operator_users"."id" = $1
         AND "platform_members"."id" = $2
         AND "operator_users"."active" = true
         AND "operator_users"."suspended_at" IS NULL
         AND "platform_members"."active" = true
         AND "platform_members"."role" = 'platform_owner'
     ) AS eligible`,
    [owner.operatorId, owner.membershipId],
  );
  return rows[0]?.eligible === true;
}

async function guardState(
  sql: SqlExecutor,
): Promise<{ armed: boolean; rowCount: number }> {
  const rows = await sql.unsafe(
    'SELECT "armed" FROM "private"."platform_owner_guard"',
  );
  return {
    armed: rows.length === 1 && rows[0]?.armed === true,
    rowCount: rows.length,
  };
}

async function tableCount(sql: SqlExecutor, table: string): Promise<number> {
  assert.match(table, /^[a-z_]+$/);
  const rows = await sql.unsafe(`SELECT count(*) AS count FROM "public"."${table}"`);
  return Number(rows[0]?.count);
}

async function expectGuardError(promise: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, "Expected the eligible owner guard to reject the operation");
  const failure = caught as PgFailure;
  assert.equal(failure.code, "23514");
  assert.equal(failure.constraint_name, guardConstraint);
}

function assertConcurrencyFailure(
  result: PromiseSettledResult<void>,
  isolation: Isolation,
): PgFailure {
  assert.equal(result.status, "rejected");
  const failure = result.reason as PgFailure;

  if (isolation === "READ COMMITTED") {
    assert.equal(failure.code, "23514");
    assert.equal(failure.constraint_name, guardConstraint);
  } else {
    assert.equal(failure.code, "40001");
  }

  return failure;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Operation exceeded ${timeoutMs} ms`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
