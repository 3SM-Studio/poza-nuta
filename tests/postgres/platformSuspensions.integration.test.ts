import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../src/db/schema.ts";
import { OperatorApiError } from "../../src/server/operator-api/errors.ts";
import {
  changePlatformMembershipRoleWithDependencies,
  deactivatePlatformMembershipWithDependencies,
  grantOrReactivatePlatformMembershipWithDependencies,
  type PlatformRoleMutationDependencies,
} from "../../src/server/platform-admin/role-mutation-core.ts";
import {
  createPlatformRoleMutationTransactionStore,
  isEligiblePlatformOwner,
} from "../../src/server/platform-admin/role-mutation-store.ts";
import {
  suspendOperatorWithDependencies,
  unlockOperatorWithDependencies,
  type PlatformSuspensionDependencies,
  type PlatformSuspensionTransactionStore,
} from "../../src/server/platform-admin/suspension-core.ts";
import {
  createPlatformSuspensionTransactionStore,
  findPlatformSuspensionActorAccess,
  findPlatformSuspensionTargetContext,
} from "../../src/server/platform-admin/suspension-store.ts";
import {
  applyPostgresMigrations,
  createPostgresDatabase,
  createPostgresTestClient,
  dropPostgresDatabase,
  installPostgresCompatibilityFixture,
  postgresDatabaseName,
  postgresTestContainerExists,
  removePostgresTestHarness,
  startPostgresTestHarness,
  withPostgresClone,
  type SqlExecutor,
} from "./postgresTestHarness.ts";

type TestDatabase = ReturnType<typeof createTestDatabase>;
type SeededOperator = { operatorId: number; membershipId: number };
type SuspensionDependencyOptions = {
  afterAuthorization?: () => Promise<void>;
  storeDecorator?: (
    store: PlatformSuspensionTransactionStore,
  ) => PlatformSuspensionTransactionStore;
};

test(
  "platform suspension services preserve RBAC, audit and owner invariants",
  { timeout: 600_000 },
  async (t) => {
    const harness = await startPostgresTestHarness(
      "pozanuta-platform-suspensions",
    );
    const admin = createPostgresTestClient(harness, "postgres");
    const templateDatabase = postgresDatabaseName("platform_suspension_template");

    try {
      await createPostgresDatabase(admin, templateDatabase);
      const template = createPostgresTestClient(harness, templateDatabase);
      try {
        await installPostgresCompatibilityFixture(template);
        await applyPostgresMigrations(template, 15);
      } finally {
        await template.end({ timeout: 5 });
      }

      for (const role of ["platform_owner", "platform_admin"] as const) {
        await t.test(`${role} suspends and unlocks an ordinary operator`, async () => {
          await withCase(harness, admin, templateDatabase, async (sql) => {
            const db = createTestDatabase(sql);
            await seedPlatformMember(sql, `${role}_backup`, "platform_owner");
            const actor = await seedPlatformMember(sql, `${role}_actor`, role);
            const target = await insertOperator(sql, `${role}_target`, true, true);
            const before = await operatorPreservedState(sql, target);
            const dependencies = suspensionDependencies(db, sql, actor.operatorId);

            const suspended = await suspendOperatorWithDependencies(
              { operatorUserId: target, reason: "  Isolated policy reason  " },
              dependencies,
            );
            assert.ok(suspended.operator.suspendedAt instanceof Date);
            assert.deepEqual(await suspensionState(sql, target), {
              suspended: true,
              reason: "Isolated policy reason",
              actorId: actor.operatorId,
            });

            const unlocked = await unlockOperatorWithDependencies(
              { operatorUserId: target },
              dependencies,
            );
            assert.equal(unlocked.operator.suspendedAt, null);
            assert.deepEqual(await suspensionState(sql, target), {
              suspended: false,
              reason: null,
              actorId: null,
            });
            assert.deepEqual(await operatorPreservedState(sql, target), before);
            assert.equal(await auditCount(sql, "success", "user.suspend"), 1);
            assert.equal(await auditCount(sql, "success", "user.unlock"), 1);
            assert.equal(await unlockAuditContainsReason(sql, target), false);
          });
        });
      }

      await t.test("admin cannot suspend an active platform owner", async () => {
        await withCase(harness, admin, templateDatabase, async (sql) => {
          const db = createTestDatabase(sql);
          await seedPlatformMember(sql, "admin_owner", "platform_owner");
          const actor = await seedPlatformMember(sql, "admin_actor", "platform_admin");
          const target = await seedPlatformMember(sql, "admin_target", "platform_owner");

          await assert.rejects(
            suspendOperatorWithDependencies(
              { operatorUserId: target.operatorId, reason: "Policy reason" },
              suspensionDependencies(db, sql, actor.operatorId),
            ),
            hasCode("PLATFORM_ACCESS_DENIED"),
          );
          assert.equal(await operatorIsSuspended(sql, target.operatorId), false);
          assert.equal(await auditCount(sql, "failure", "user.suspend"), 0);
        });
      });

      await t.test("owner suspends and unlocks another owner", async () => {
        await withCase(harness, admin, templateDatabase, async (sql) => {
          const db = createTestDatabase(sql);
          const actor = await seedPlatformMember(sql, "owner_actor", "platform_owner");
          const target = await seedPlatformMember(sql, "owner_target", "platform_owner");
          const dependencies = suspensionDependencies(db, sql, actor.operatorId);

          await suspendOperatorWithDependencies(
            { operatorUserId: target.operatorId, reason: "Policy reason" },
            dependencies,
          );
          assert.equal(await eligibleOwnerCount(sql), 1);
          await unlockOperatorWithDependencies(
            { operatorUserId: target.operatorId },
            dependencies,
          );
          assert.equal(await eligibleOwnerCount(sql), 2);
        });
      });

      await t.test("two owner-sensitive suspensions leave one eligible owner", async () => {
        await withCase(harness, admin, templateDatabase, async (sql) => {
          const db = createTestDatabase(sql);
          const left = await seedPlatformMember(sql, "cross_left", "platform_owner");
          const right = await seedPlatformMember(sql, "cross_right", "platform_owner");

          const results = await Promise.allSettled([
            suspendOperatorWithDependencies(
              { operatorUserId: right.operatorId, reason: "Left operation" },
              suspensionDependencies(db, sql, left.operatorId),
            ),
            suspendOperatorWithDependencies(
              { operatorUserId: left.operatorId, reason: "Right operation" },
              suspensionDependencies(db, sql, right.operatorId),
            ),
          ]);

          assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
          const rejected = results.find(({ status }) => status === "rejected");
          assert.ok(rejected?.status === "rejected");
          assert.ok(rejected.reason instanceof OperatorApiError);
          assert.equal(rejected.reason.code, "PLATFORM_ACCESS_DENIED");
          assert.equal(await eligibleOwnerCount(sql), 1);
          assert.equal(await auditCount(sql, "success", "user.suspend"), 1);
          assert.equal(await auditCount(sql, "failure", "user.suspend"), 0);
        });
      });

      await t.test("duplicate suspend and unlock serialize into success plus conflict", async () => {
        await withCase(harness, admin, templateDatabase, async (sql) => {
          const db = createTestDatabase(sql);
          const actor = await seedPlatformMember(sql, "duplicate_actor", "platform_owner");
          const target = await insertOperator(sql, "duplicate_target");
          const left = suspensionDependencies(db, sql, actor.operatorId);
          const right = suspensionDependencies(db, sql, actor.operatorId);

          const suspendResults = await Promise.allSettled([
            suspendOperatorWithDependencies(
              { operatorUserId: target, reason: "Duplicate left" },
              left,
            ),
            suspendOperatorWithDependencies(
              { operatorUserId: target, reason: "Duplicate right" },
              right,
            ),
          ]);
          assertOneSuccessAndCode(suspendResults, "OPERATOR_ALREADY_SUSPENDED");
          assert.equal(await auditCount(sql, "success", "user.suspend"), 1);
          assert.equal(await auditCount(sql, "failure", "user.suspend"), 1);

          const unlockResults = await Promise.allSettled([
            unlockOperatorWithDependencies({ operatorUserId: target }, left),
            unlockOperatorWithDependencies({ operatorUserId: target }, right),
          ]);
          assertOneSuccessAndCode(unlockResults, "OPERATOR_NOT_SUSPENDED");
          assert.equal(await auditCount(sql, "success", "user.unlock"), 1);
          assert.equal(await auditCount(sql, "failure", "user.unlock"), 1);
        });
      });

      await t.test("concurrent deactivation makes suspend classify the target as inactive", async () => {
        await withCase(harness, admin, templateDatabase, async (sql, database) => {
          const observer = createPostgresTestClient(harness, database, 1);
          try {
            const db = createTestDatabase(sql);
            const actor = await seedPlatformMember(
              sql,
              "deactivate_suspend_actor",
              "platform_owner",
            );
            const target = await insertOperator(sql, "deactivate_suspend_target");
            const heldDeactivation = await holdOperatorDeactivation(sql, target);
            const suspension = settle(
              suspendOperatorWithDependencies(
                { operatorUserId: target, reason: "Concurrent deactivation" },
                suspensionDependencies(db, sql, actor.operatorId),
              ),
            );

            const result = await completeAfterObservedBlock(
              observer,
              database,
              heldDeactivation,
              suspension,
            );
            assert.equal(result.status, "rejected");
            assert.ok(result.reason instanceof OperatorApiError);
            assert.equal(result.reason.code, "TARGET_OPERATOR_INACTIVE");
            assert.deepEqual(await suspensionState(sql, target), {
              suspended: false,
              reason: null,
              actorId: null,
            });
            assert.equal(await auditCount(sql, "success", "user.suspend"), 0);
            assert.equal(await auditCount(sql, "failure", "user.suspend"), 1);
          } finally {
            await observer.end({ timeout: 5 });
          }
        });
      });

      await t.test("concurrent deactivation makes unlock classify the target as inactive", async () => {
        await withCase(harness, admin, templateDatabase, async (sql, database) => {
          const observer = createPostgresTestClient(harness, database, 1);
          try {
            const db = createTestDatabase(sql);
            const actor = await seedPlatformMember(
              sql,
              "deactivate_unlock_actor",
              "platform_owner",
            );
            const target = await insertOperator(sql, "deactivate_unlock_target");
            const dependencies = suspensionDependencies(db, sql, actor.operatorId);
            await suspendOperatorWithDependencies(
              { operatorUserId: target, reason: "Reason that must remain" },
              dependencies,
            );
            const before = await suspensionState(sql, target);
            const heldDeactivation = await holdOperatorDeactivation(sql, target);
            const unlock = settle(
              unlockOperatorWithDependencies({ operatorUserId: target }, dependencies),
            );

            const result = await completeAfterObservedBlock(
              observer,
              database,
              heldDeactivation,
              unlock,
            );
            assert.equal(result.status, "rejected");
            assert.ok(result.reason instanceof OperatorApiError);
            assert.equal(result.reason.code, "TARGET_OPERATOR_INACTIVE");
            assert.deepEqual(await suspensionState(sql, target), before);
            assert.equal(await auditCount(sql, "success", "user.unlock"), 0);
            assert.equal(await auditCount(sql, "failure", "user.unlock"), 1);
          } finally {
            await observer.end({ timeout: 5 });
          }
        });
      });

      for (const operation of ["demotion", "deactivation"] as const) {
        await t.test(`suspension concurrent with owner ${operation} preserves invariant`, async () => {
          await withCase(harness, admin, templateDatabase, async (sql) => {
            const db = createTestDatabase(sql);
            const actor = await seedPlatformMember(sql, `${operation}_actor`, "platform_owner");
            const suspendTarget = await seedPlatformMember(
              sql,
              `${operation}_suspend`,
              "platform_owner",
            );
            const roleTarget = await seedPlatformMember(
              sql,
              `${operation}_role`,
              "platform_owner",
            );
            const suspension = suspendOperatorWithDependencies(
              { operatorUserId: suspendTarget.operatorId, reason: "Race reason" },
              suspensionDependencies(db, sql, actor.operatorId),
            );
            const roleDependencies = roleMutationDependencies(
              db,
              sql,
              actor.operatorId,
            );
            const roleMutation =
              operation === "demotion"
                ? changePlatformMembershipRoleWithDependencies(
                    {
                      membershipId: roleTarget.membershipId,
                      expectedRole: "platform_owner",
                      role: "platform_admin",
                    },
                    roleDependencies,
                  )
                : deactivatePlatformMembershipWithDependencies(
                    { membershipId: roleTarget.membershipId },
                    roleDependencies,
                  );

            const results = await Promise.allSettled([suspension, roleMutation]);
            assert.ok(results.every(({ status }) => status === "fulfilled"));
            assert.equal(await eligibleOwnerCount(sql), 1);
          });
        });
      }

      await t.test("committed owner grant prevents concurrent admin suspension", async () => {
        await withCase(harness, admin, templateDatabase, async (sql) => {
          const db = createTestDatabase(sql);
          const owner = await seedPlatformMember(sql, "grant_owner", "platform_owner");
          const adminActor = await seedPlatformMember(sql, "grant_admin", "platform_admin");
          const target = await insertOperator(sql, "grant_target");
          const grantReady = deferred<void>();
          const releaseGrant = deferred<void>();
          const grantDependencies = roleMutationDependencies(
            db,
            sql,
            owner.operatorId,
            async () => {
              grantReady.resolve();
              await releaseGrant.promise;
            },
          );

          const grant = grantOrReactivatePlatformMembershipWithDependencies(
            { operatorUserId: target, role: "platform_owner" },
            grantDependencies,
          );
          await grantReady.promise;
          const suspension = suspendOperatorWithDependencies(
            { operatorUserId: target, reason: "Concurrent admin operation" },
            suspensionDependencies(db, sql, adminActor.operatorId),
          );
          await delay(100);
          releaseGrant.resolve();

          await grant;
          await assert.rejects(suspension, hasCode("PLATFORM_ACCESS_DENIED"));
          assert.equal(await activePlatformRole(sql, target), "platform_owner");
          assert.equal(await operatorIsSuspended(sql, target), false);
          assert.equal(await auditCount(sql, "success", "user.suspend"), 0);
          assert.equal(await auditCount(sql, "failure", "user.suspend"), 0);
        });
      });

      await t.test("actor permission loss after authorization prevents mutation", async () => {
        await withCase(harness, admin, templateDatabase, async (sql) => {
          const db = createTestDatabase(sql);
          const actor = await seedPlatformMember(sql, "stale_actor", "platform_owner");
          await seedPlatformMember(sql, "stale_backup", "platform_owner");
          const target = await insertOperator(sql, "stale_target");

          await assert.rejects(
            suspendOperatorWithDependencies(
              { operatorUserId: target, reason: "Stale actor" },
              suspensionDependencies(db, sql, actor.operatorId, {
                afterAuthorization: async () => {
                  await sql.unsafe(
                    `UPDATE "public"."platform_members"
                     SET "role" = 'support'
                     WHERE "id" = $1`,
                    [actor.membershipId],
                  );
                },
              }),
            ),
            hasCode("PLATFORM_ACCESS_DENIED"),
          );
          assert.equal(await operatorIsSuspended(sql, target), false);
          assert.equal(await auditCount(sql, "failure", "user.suspend"), 0);
        });
      });

      await t.test("success audit failure rolls back the suspension", async () => {
        await withCase(harness, admin, templateDatabase, async (sql) => {
          const db = createTestDatabase(sql);
          const actor = await seedPlatformMember(sql, "audit_actor", "platform_owner");
          const target = await insertOperator(sql, "audit_target");

          await assert.rejects(
            suspendOperatorWithDependencies(
              { operatorUserId: target, reason: "Audit rollback" },
              suspensionDependencies(db, sql, actor.operatorId, {
                storeDecorator: (store) => ({
                  ...store,
                  insertAuditRecord: async () => {
                    throw new Error("isolated audit failure");
                  },
                }),
              }),
            ),
            hasCode("PLATFORM_AUDIT_FAILED"),
          );
          assert.equal(await operatorIsSuspended(sql, target), false);
          assert.equal(await auditCount(sql, "success", "user.suspend"), 0);
        });
      });
    } finally {
      await dropPostgresDatabase(admin, templateDatabase);
      await admin.end({ timeout: 5 });
      harness.password = "";
      await removePostgresTestHarness(harness.containerName);
      assert.equal(await postgresTestContainerExists(harness.containerName), false);
    }
  },
);

function suspensionDependencies(
  db: TestDatabase,
  sql: postgres.Sql,
  actorOperatorId: number,
  options: SuspensionDependencyOptions = {},
): PlatformSuspensionDependencies {
  return {
    authorizeActor: async () => {
      const actor = await platformActor(sql, actorOperatorId);
      if (
        !actor ||
        (actor.role !== "platform_owner" && actor.role !== "platform_admin")
      ) {
        throw accessDenied();
      }
      await options.afterAuthorization?.();
      return { operatorId: actorOperatorId };
    },
    runTransaction: (callback) =>
      db.transaction(async (transaction) => {
        const store = createPlatformSuspensionTransactionStore(transaction);
        return callback(options.storeDecorator?.(store) ?? store);
      }),
    findActorAccess: (operatorUserId) =>
      findPlatformSuspensionActorAccess(db, operatorUserId),
    findTargetContext: (operatorUserId) =>
      findPlatformSuspensionTargetContext(db, operatorUserId),
    insertFailureAuditRecord: async (record) => {
      await db.insert(schema.operatorAuditLog).values(record);
    },
    waitBeforeRetry: async () => undefined,
    retryDelayMilliseconds: () => 0,
  };
}

function roleMutationDependencies(
  db: TestDatabase,
  sql: postgres.Sql,
  actorOperatorId: number,
  afterTransactionWork?: () => Promise<void>,
): PlatformRoleMutationDependencies {
  return {
    authorizeActor: async () => {
      const actor = await platformActor(sql, actorOperatorId);
      if (!actor || actor.role !== "platform_owner") throw accessDenied();
      return { operatorId: actorOperatorId };
    },
    runTransaction: (callback) =>
      db.transaction(async (transaction) => {
        const result = await callback(
          createPlatformRoleMutationTransactionStore(transaction),
        );
        await afterTransactionWork?.();
        return result;
      }),
    isActorEligible: (operatorUserId) =>
      isEligiblePlatformOwner(db, operatorUserId),
    insertFailureAuditRecord: async (record) => {
      await db.insert(schema.operatorAuditLog).values(record);
    },
    waitBeforeRetry: async () => undefined,
    retryDelayMilliseconds: () => 0,
  };
}

function createTestDatabase(client: postgres.Sql) {
  return drizzle({ client, schema });
}

async function withCase(
  harness: Awaited<ReturnType<typeof startPostgresTestHarness>>,
  admin: postgres.Sql,
  template: string,
  callback: (sql: postgres.Sql, database: string) => Promise<void>,
) {
  await withPostgresClone(
    harness,
    admin,
    template,
    "platform_suspension_case",
    callback,
  );
}

async function insertOperator(
  sql: SqlExecutor,
  label: string,
  active = true,
  withAuthIdentity = false,
): Promise<number> {
  const authUserId = withAuthIdentity ? randomUUID() : null;
  if (authUserId) {
    await sql.unsafe('INSERT INTO "auth"."users" ("id") VALUES ($1)', [
      authUserId,
    ]);
  }
  const rows = await sql.unsafe(
    `INSERT INTO "public"."operator_users"
       ("name", "password_hash", "active", "auth_user_id")
     VALUES ($1, 'test-only-hash', $2, $3)
     RETURNING "id"`,
    [`test_${label}_${randomUUID()}`, active, authUserId],
  );
  return numericId(rows[0]?.id);
}

async function seedPlatformMember(
  sql: SqlExecutor,
  label: string,
  role: "platform_owner" | "platform_admin" | "support",
): Promise<SeededOperator> {
  const operatorId = await insertOperator(sql, label);
  const rows = await sql.unsafe(
    `INSERT INTO "public"."platform_members" ("operator_user_id", "role", "active")
     VALUES ($1, $2::platform_member_role, true)
     RETURNING "id"`,
    [operatorId, role],
  );
  return { operatorId, membershipId: numericId(rows[0]?.id) };
}

async function platformActor(sql: SqlExecutor, operatorId: number) {
  const rows = await sql.unsafe(
    `SELECT "platform_members"."role"::text AS "role"
     FROM "public"."operator_users"
     INNER JOIN "public"."platform_members"
       ON "platform_members"."operator_user_id" = "operator_users"."id"
     WHERE "operator_users"."id" = $1
       AND "operator_users"."active" = true
       AND "operator_users"."suspended_at" IS NULL
       AND "platform_members"."active" = true`,
    [operatorId],
  );
  return rows[0] as { role?: string } | undefined;
}

async function suspensionState(sql: SqlExecutor, operatorId: number) {
  const rows = await sql.unsafe(
    `SELECT
       "suspended_at" IS NOT NULL AS "suspended",
       "suspension_reason" AS "reason",
       "suspended_by_operator_id" AS "actor_id"
     FROM "public"."operator_users"
     WHERE "id" = $1`,
    [operatorId],
  );
  return {
    suspended: rows[0]?.suspended === true,
    reason: (rows[0]?.reason as string | null | undefined) ?? null,
    actorId: rows[0]?.actor_id ? numericId(rows[0].actor_id) : null,
  };
}

async function operatorPreservedState(sql: SqlExecutor, operatorId: number) {
  const rows = await sql.unsafe(
    `SELECT "active", "auth_user_id"::text AS "auth_user_id"
     FROM "public"."operator_users"
     WHERE "id" = $1`,
    [operatorId],
  );
  const memberships = await sql.unsafe(
    `SELECT count(*) AS "count"
     FROM "public"."platform_members"
     WHERE "operator_user_id" = $1`,
    [operatorId],
  );
  return {
    active: rows[0]?.active === true,
    authUserId: rows[0]?.auth_user_id as string | null,
    membershipCount: Number(memberships[0]?.count),
  };
}

async function operatorIsSuspended(sql: SqlExecutor, operatorId: number) {
  return (await suspensionState(sql, operatorId)).suspended;
}

async function activePlatformRole(sql: SqlExecutor, operatorId: number) {
  const rows = await sql.unsafe(
    `SELECT "role"::text AS "role"
     FROM "public"."platform_members"
     WHERE "operator_user_id" = $1 AND "active" = true`,
    [operatorId],
  );
  return rows[0]?.role as string | undefined;
}

async function eligibleOwnerCount(sql: SqlExecutor) {
  const rows = await sql.unsafe(`
    SELECT count(*) AS "count"
    FROM "public"."operator_users"
    INNER JOIN "public"."platform_members"
      ON "platform_members"."operator_user_id" = "operator_users"."id"
    WHERE "operator_users"."active" = true
      AND "operator_users"."suspended_at" IS NULL
      AND "platform_members"."active" = true
      AND "platform_members"."role" = 'platform_owner'
  `);
  return Number(rows[0]?.count);
}

async function holdOperatorDeactivation(sql: postgres.Sql, operatorId: number) {
  const ready = deferred<number>();
  const release = deferred<void>();
  const completed = (async () => {
    try {
      await sql.begin(async (transaction) => {
        const backend = await transaction.unsafe(
          'SELECT pg_backend_pid() AS "backend_pid"',
        );
        await transaction.unsafe(
          `UPDATE "public"."operator_users"
           SET "active" = false, "updated_at" = now()
           WHERE "id" = $1`,
          [operatorId],
        );
        ready.resolve(numericId(backend[0]?.backend_pid));
        await release.promise;
      });
    } catch (error) {
      ready.reject(error);
      throw error;
    }
  });
  const transaction = completed();
  void transaction.catch(() => undefined);

  return {
    backendPid: await ready.promise,
    completed: transaction,
    release: () => release.resolve(),
  };
}

async function completeAfterObservedBlock<T>(
  observer: SqlExecutor,
  database: string,
  heldDeactivation: Awaited<ReturnType<typeof holdOperatorDeactivation>>,
  operation: Promise<T>,
) {
  let observationError: unknown;
  try {
    await waitForBlockedByBackend(
      observer,
      database,
      heldDeactivation.backendPid,
    );
  } catch (error) {
    observationError = error;
  } finally {
    heldDeactivation.release();
    await heldDeactivation.completed;
  }

  const result = await operation;
  if (observationError) throw observationError;
  return result;
}

async function waitForBlockedByBackend(
  observer: SqlExecutor,
  database: string,
  backendPid: number,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await observer.unsafe(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_stat_activity AS waiting
         WHERE waiting.pid <> $1
           AND $1 = ANY(pg_blocking_pids(waiting.pid))
           AND waiting.datname = $2
           AND waiting.wait_event_type = 'Lock'
       ) AS "blocked"`,
      [backendPid, database],
    );
    if (rows[0]?.blocked === true) return;
    await delay(10);
  }
  assert.fail("Suspension mutation did not wait on the held operator row lock.");
}

async function auditCount(
  sql: SqlExecutor,
  outcome: "success" | "failure",
  action: "user.suspend" | "user.unlock",
) {
  const rows = await sql.unsafe(
    `SELECT count(*) AS "count"
     FROM "public"."operator_audit_log"
     WHERE "action" = $1
       AND "payload"->>'outcome' = $2`,
    [action, outcome],
  );
  return Number(rows[0]?.count);
}

async function unlockAuditContainsReason(
  sql: SqlExecutor,
  operatorId: number,
) {
  const rows = await sql.unsafe(
    `SELECT "payload" ? 'reason' AS "has_reason"
     FROM "public"."operator_audit_log"
     WHERE "action" = 'user.unlock' AND "entity_id" = $1
     ORDER BY "id" DESC
     LIMIT 1`,
    [String(operatorId)],
  );
  return rows[0]?.has_reason === true;
}

function assertOneSuccessAndCode(
  results: PromiseSettledResult<unknown>[],
  expectedCode: string,
) {
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = results.find(({ status }) => status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof OperatorApiError);
  assert.equal(rejected.reason.code, expectedCode);
}

function numericId(value: unknown) {
  const id = Number(value);
  assert.ok(Number.isSafeInteger(id) && id > 0);
  return id;
}

function hasCode(expectedCode: string) {
  return (error: unknown) =>
    error instanceof OperatorApiError && error.code === expectedCode;
}

function settle<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
}

function accessDenied() {
  return new OperatorApiError(
    403,
    "PLATFORM_ACCESS_DENIED",
    "Platform access is not permitted.",
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function delay(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
