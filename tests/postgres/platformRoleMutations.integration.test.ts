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
  removePlatformMembershipWithDependencies,
  type PlatformRoleMutationDependencies,
  type PlatformRoleMutationTransactionStore,
} from "../../src/server/platform-admin/role-mutation-core.ts";
import {
  createPlatformRoleMutationTransactionStore,
  isEligiblePlatformOwner,
} from "../../src/server/platform-admin/role-mutation-store.ts";
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

test(
  "platform role mutation services preserve RBAC, audit and owner invariants",
  { timeout: 600_000 },
  async (t) => {
    const harness = await startPostgresTestHarness(
      "pozanuta-platform-role-mutations",
    );
    const admin = createPostgresTestClient(harness, "postgres");
    const templateDatabase = postgresDatabaseName("platform_role_template");

    try {
      await createPostgresDatabase(admin, templateDatabase);
      const template = createPostgresTestClient(harness, templateDatabase);
      try {
        await installPostgresCompatibilityFixture(template);
        await applyPostgresMigrations(template, 15);
      } finally {
        await template.end({ timeout: 5 });
      }

      await t.test(
        "grant, reactivate, change, deactivate and remove use the real store",
        async () => {
          await withCase(harness, admin, templateDatabase, async (sql) => {
            const db = createTestDatabase(sql);
            const actor = await seedPlatformMember(sql, "actor", "platform_owner");
            const grantTarget = await insertOperator(sql, "grant_target");
            const suspendedTarget = await insertOperator(sql, "suspended_target");
            await suspendOperator(sql, suspendedTarget, actor.operatorId);
            const inactiveTarget = await seedPlatformMember(
              sql,
              "inactive_target",
              "support",
              false,
            );
            const changeTarget = await seedPlatformMember(
              sql,
              "change_target",
              "support",
            );
            const deactivateTarget = await seedPlatformMember(
              sql,
              "deactivate_target",
              "support",
            );
            const removeTarget = await seedPlatformMember(
              sql,
              "remove_target",
              "support",
            );
            const dependencies = serviceDependencies(db, sql, actor.operatorId);

            const granted = await grantOrReactivatePlatformMembershipWithDependencies(
              { operatorUserId: grantTarget, role: "support" },
              dependencies,
            );
            const suspendedGrant =
              await grantOrReactivatePlatformMembershipWithDependencies(
                { operatorUserId: suspendedTarget, role: "support" },
                dependencies,
              );
            const reactivated =
              await grantOrReactivatePlatformMembershipWithDependencies(
                {
                  operatorUserId: inactiveTarget.operatorId,
                  role: "platform_admin",
                },
                dependencies,
              );
            const changed = await changePlatformMembershipRoleWithDependencies(
              {
                membershipId: changeTarget.membershipId,
                expectedRole: "support",
                role: "platform_admin",
              },
              dependencies,
            );
            const deactivated =
              await deactivatePlatformMembershipWithDependencies(
                { membershipId: deactivateTarget.membershipId },
                dependencies,
              );
            const removed = await removePlatformMembershipWithDependencies(
              { membershipId: removeTarget.membershipId },
              dependencies,
            );

            assert.equal(granted.operation, "grant");
            assert.equal(suspendedGrant.operation, "grant");
            assert.equal(reactivated.operation, "reactivate");
            assert.equal(reactivated.membership.role, "platform_admin");
            assert.equal(changed.membership.role, "platform_admin");
            assert.equal(deactivated.membership.active, false);
            assert.equal(removed.operation, "remove");
            assert.equal(await membershipExists(sql, removeTarget.membershipId), false);
            assert.equal(await operatorIsSuspended(sql, suspendedTarget), true);
            assert.equal(await auditCount(sql, "success"), 6);
          });
        },
      );

      await t.test(
        "inactive targets and active memberships return safe domain conflicts",
        async () => {
          await withCase(harness, admin, templateDatabase, async (sql) => {
            const db = createTestDatabase(sql);
            const actor = await seedPlatformMember(sql, "actor", "platform_owner");
            const inactiveOperator = await insertOperator(sql, "inactive", false);
            const activeMembership = await seedPlatformMember(
              sql,
              "active_member",
              "support",
            );
            const dependencies = serviceDependencies(db, sql, actor.operatorId);

            await assert.rejects(
              grantOrReactivatePlatformMembershipWithDependencies(
                { operatorUserId: inactiveOperator, role: "support" },
                dependencies,
              ),
              hasCode("TARGET_OPERATOR_INACTIVE"),
            );
            await assert.rejects(
              grantOrReactivatePlatformMembershipWithDependencies(
                { operatorUserId: activeMembership.operatorId, role: "support" },
                dependencies,
              ),
              hasCode("PLATFORM_MEMBERSHIP_ACTIVE"),
            );
            assert.equal(await auditCount(sql, "failure"), 2);
          });
        },
      );

      await t.test(
        "concurrent grants produce one success and one active-membership conflict",
        async () => {
          await withCase(harness, admin, templateDatabase, async (sql) => {
            const db = createTestDatabase(sql);
            const actor = await seedPlatformMember(sql, "actor", "platform_owner");
            const targetOperatorId = await insertOperator(sql, "grant_race");

            await assertConcurrentGrantOrReactivate(
              db,
              sql,
              actor.operatorId,
              targetOperatorId,
            );
          });
        },
      );

      await t.test(
        "concurrent reactivations produce one success and one active-membership conflict",
        async () => {
          await withCase(harness, admin, templateDatabase, async (sql) => {
            const db = createTestDatabase(sql);
            const actor = await seedPlatformMember(sql, "actor", "platform_owner");
            const target = await seedPlatformMember(
              sql,
              "reactivate_race",
              "support",
              false,
            );

            await assertConcurrentGrantOrReactivate(
              db,
              sql,
              actor.operatorId,
              target.operatorId,
            );
          });
        },
      );

      await t.test(
        "admin and support are denied before any target transaction",
        async () => {
          await withCase(harness, admin, templateDatabase, async (sql) => {
            const db = createTestDatabase(sql);
            await seedPlatformMember(sql, "owner", "platform_owner");
            const adminActor = await seedPlatformMember(
              sql,
              "admin",
              "platform_admin",
            );
            const supportActor = await seedPlatformMember(sql, "support", "support");
            const target = await insertOperator(sql, "target");

            for (const actor of [adminActor, supportActor]) {
              let transactionCalls = 0;
              const dependencies = serviceDependencies(db, sql, actor.operatorId, {
                onTransaction: () => {
                  transactionCalls += 1;
                },
              });

              await assert.rejects(
                grantOrReactivatePlatformMembershipWithDependencies(
                  { operatorUserId: target, role: "support" },
                  dependencies,
                ),
                hasCode("PLATFORM_ACCESS_DENIED"),
              );
              assert.equal(transactionCalls, 0);
            }
          });
        },
      );

      await t.test(
        "owner self-mutations are rejected and failure-audited",
        async () => {
          await withCase(harness, admin, templateDatabase, async (sql) => {
            const db = createTestDatabase(sql);
            const actor = await seedPlatformMember(sql, "actor", "platform_owner");
            const dependencies = serviceDependencies(db, sql, actor.operatorId);

            await assert.rejects(
              changePlatformMembershipRoleWithDependencies(
                {
                  membershipId: actor.membershipId,
                  expectedRole: "platform_owner",
                  role: "platform_admin",
                },
                dependencies,
              ),
              hasCode("PLATFORM_ROLE_SELF_MUTATION"),
            );
            await assert.rejects(
              deactivatePlatformMembershipWithDependencies(
                { membershipId: actor.membershipId },
                dependencies,
              ),
              hasCode("PLATFORM_ROLE_SELF_MUTATION"),
            );
            await assert.rejects(
              removePlatformMembershipWithDependencies(
                { membershipId: actor.membershipId },
                dependencies,
              ),
              hasCode("PLATFORM_ROLE_SELF_MUTATION"),
            );

            assert.equal(await eligibleOwnerCount(sql), 1);
            assert.equal(await auditCount(sql, "failure"), 3);
          });
        },
      );

      await t.test(
        "actor eligibility takes precedence over a target guard failure",
        async () => {
          await withCase(harness, admin, templateDatabase, async (sql) => {
            const db = createTestDatabase(sql);
            const actor = await seedPlatformMember(sql, "actor", "platform_owner");
            const target = await seedPlatformMember(sql, "target", "platform_owner");
            let actorDemoted = false;
            const dependencies = serviceDependencies(db, sql, actor.operatorId, {
              storeDecorator: (store) => ({
                ...store,
                isEligiblePlatformOwner: async (operatorUserId) => {
                  const eligible = await store.isEligiblePlatformOwner(
                    operatorUserId,
                  );
                  if (!actorDemoted) {
                    actorDemoted = true;
                    await sql.unsafe(
                      'UPDATE "public"."platform_members" SET "role" = \'platform_admin\' WHERE "id" = $1',
                      [actor.membershipId],
                    );
                  }
                  return eligible;
                },
              }),
            });

            await assert.rejects(
              deactivatePlatformMembershipWithDependencies(
                { membershipId: target.membershipId },
                dependencies,
              ),
              hasCode("PLATFORM_ACCESS_DENIED"),
            );
            assert.equal(await eligibleOwnerCount(sql), 1);
            assert.equal(await membershipIsActive(sql, target.membershipId), true);
            assert.equal(await auditCount(sql, "failure"), 0);
          });
        },
      );

      await t.test(
        "mutation and success audit commit atomically",
        async () => {
          await withCase(harness, admin, templateDatabase, async (sql) => {
            const db = createTestDatabase(sql);
            const actor = await seedPlatformMember(sql, "actor", "platform_owner");
            const target = await seedPlatformMember(sql, "target", "support");
            const dependencies = serviceDependencies(db, sql, actor.operatorId, {
              storeDecorator: (store) => ({
                ...store,
                insertAuditRecord: async () => {
                  throw new Error("isolated audit failure");
                },
              }),
            });

            await assert.rejects(
              deactivatePlatformMembershipWithDependencies(
                { membershipId: target.membershipId },
                dependencies,
              ),
              hasCode("PLATFORM_AUDIT_FAILED"),
            );
            assert.equal(await membershipIsActive(sql, target.membershipId), true);
            assert.equal(await auditCount(sql, "success"), 0);
          });
        },
      );

      await t.test(
        "actor revalidation rolls back a stale authorized mutation",
        async () => {
          await withCase(harness, admin, templateDatabase, async (sql) => {
            const db = createTestDatabase(sql);
            const actor = await seedPlatformMember(sql, "actor", "platform_owner");
            await seedPlatformMember(sql, "replacement", "platform_owner");
            const target = await seedPlatformMember(sql, "target", "support");
            const dependencies = serviceDependencies(db, sql, actor.operatorId, {
              afterAuthorization: async () => {
                await sql.unsafe(
                  'UPDATE "public"."platform_members" SET "role" = \'platform_admin\' WHERE "id" = $1',
                  [actor.membershipId],
                );
              },
            });

            await assert.rejects(
              deactivatePlatformMembershipWithDependencies(
                { membershipId: target.membershipId },
                dependencies,
              ),
              hasCode("PLATFORM_ACCESS_DENIED"),
            );
            assert.equal(await membershipIsActive(sql, target.membershipId), true);
            assert.equal(await auditCount(sql, "success"), 0);
          });
        },
      );

      await t.test(
        "a retry rolls back its provisional audit and leaves one final audit",
        async () => {
          await withCase(harness, admin, templateDatabase, async (sql) => {
            const db = createTestDatabase(sql);
            const actor = await seedPlatformMember(sql, "actor", "platform_owner");
            const target = await seedPlatformMember(sql, "target", "support");
            let transactionAttempt = 0;
            const dependencies = serviceDependencies(db, sql, actor.operatorId, {
              afterTransactionWork: async () => {
                transactionAttempt += 1;
                if (transactionAttempt === 1) throw postgresFailure("40001");
              },
            });

            await deactivatePlatformMembershipWithDependencies(
              { membershipId: target.membershipId },
              dependencies,
            );

            assert.equal(transactionAttempt, 2);
            assert.equal(await membershipIsActive(sql, target.membershipId), false);
            assert.equal(await auditCount(sql, "success"), 1);
          });
        },
      );

      await t.test(
        "concurrent owner-sensitive mutations serialize without losing all owners",
        async () => {
          await withCase(harness, admin, templateDatabase, async (sql) => {
            const db = createTestDatabase(sql);
            const actor = await seedPlatformMember(sql, "actor", "platform_owner");
            const left = await seedPlatformMember(sql, "left", "platform_owner");
            const right = await seedPlatformMember(sql, "right", "platform_owner");
            const leftDependencies = serviceDependencies(db, sql, actor.operatorId);
            const rightDependencies = serviceDependencies(db, sql, actor.operatorId);

            const results = await Promise.allSettled([
              deactivatePlatformMembershipWithDependencies(
                { membershipId: left.membershipId },
                leftDependencies,
              ),
              deactivatePlatformMembershipWithDependencies(
                { membershipId: right.membershipId },
                rightDependencies,
              ),
            ]);

            assert.ok(results.every(({ status }) => status === "fulfilled"));
            assert.equal(await eligibleOwnerCount(sql), 1);
            assert.equal(await auditCount(sql, "success"), 2);
          });
        },
      );
    } finally {
      await dropPostgresDatabase(admin, templateDatabase);
      await admin.end({ timeout: 5 });
      harness.password = "";
      await removePostgresTestHarness(harness.containerName);
      assert.equal(
        await postgresTestContainerExists(harness.containerName),
        false,
      );
    }
  },
);

type ServiceDependencyOptions = {
  onTransaction?: () => void;
  afterAuthorization?: () => Promise<void>;
  beforeTransactionWork?: () => Promise<void>;
  afterTransactionWork?: () => Promise<void>;
  storeDecorator?: (
    store: PlatformRoleMutationTransactionStore,
  ) => PlatformRoleMutationTransactionStore;
};

function serviceDependencies(
  db: TestDatabase,
  sql: postgres.Sql,
  actorOperatorId: number,
  options: ServiceDependencyOptions = {},
): PlatformRoleMutationDependencies {
  return {
    authorizeActor: async () => {
      const actor = await platformActor(sql, actorOperatorId);
      if (!actor || actor.role !== "platform_owner") {
        throw new OperatorApiError(
          403,
          "PLATFORM_ACCESS_DENIED",
          "Platform access is not permitted.",
        );
      }
      await options.afterAuthorization?.();
      return { operatorId: actorOperatorId };
    },
    runTransaction: (callback) => {
      options.onTransaction?.();
      return db.transaction(async (transaction) => {
        await options.beforeTransactionWork?.();
        const baseStore = createPlatformRoleMutationTransactionStore(transaction);
        const result = await callback(
          options.storeDecorator?.(baseStore) ?? baseStore,
        );
        await options.afterTransactionWork?.();
        return result;
      });
    },
    isActorEligible: (operatorUserId) =>
      isEligiblePlatformOwner(db, operatorUserId),
    insertFailureAuditRecord: async (record) => {
      await db.insert(schema.operatorAuditLog).values(record);
    },
    waitBeforeRetry: async () => undefined,
    retryDelayMilliseconds: () => 0,
  };
}

async function assertConcurrentGrantOrReactivate(
  db: TestDatabase,
  sql: postgres.Sql,
  actorOperatorId: number,
  targetOperatorId: number,
) {
  const barrier = createBarrier(2);
  const leftDependencies = serviceDependencies(db, sql, actorOperatorId, {
    beforeTransactionWork: barrier,
  });
  const rightDependencies = serviceDependencies(db, sql, actorOperatorId, {
    beforeTransactionWork: barrier,
  });

  const results = await Promise.allSettled([
    grantOrReactivatePlatformMembershipWithDependencies(
      { operatorUserId: targetOperatorId, role: "support" },
      leftDependencies,
    ),
    grantOrReactivatePlatformMembershipWithDependencies(
      { operatorUserId: targetOperatorId, role: "support" },
      rightDependencies,
    ),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.find((result) => result.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof OperatorApiError);
  assert.equal(rejected.reason.code, "PLATFORM_MEMBERSHIP_ACTIVE");
  assert.notEqual(rejected.reason.code, "PLATFORM_ROLE_MUTATION_FAILED");
  assert.deepEqual(await platformMembershipState(sql, targetOperatorId), {
    count: 1,
    active: true,
  });
  assert.equal(await auditCount(sql, "success"), 1);
  assert.equal(await auditCount(sql, "failure"), 1);
}

function createBarrier(participants: number) {
  let arrivals = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrivals += 1;
    if (arrivals === participants) release();
    await released;
  };
}

function createTestDatabase(client: postgres.Sql) {
  return drizzle({ client, schema });
}

async function withCase(
  harness: Awaited<ReturnType<typeof startPostgresTestHarness>>,
  admin: postgres.Sql,
  template: string,
  callback: (sql: postgres.Sql) => Promise<void>,
) {
  await withPostgresClone(
    harness,
    admin,
    template,
    "platform_role_case",
    async (sql) => callback(sql),
  );
}

async function insertOperator(
  sql: SqlExecutor,
  label: string,
  active = true,
): Promise<number> {
  const rows = await sql.unsafe(
    `INSERT INTO "public"."operator_users" ("name", "password_hash", "active")
     VALUES ($1, 'test-only-hash', $2)
     RETURNING "id"`,
    [`test_${label}_${randomUUID()}`, active],
  );
  return numericId(rows[0]?.id);
}

async function seedPlatformMember(
  sql: SqlExecutor,
  label: string,
  role: "platform_owner" | "platform_admin" | "support",
  active = true,
): Promise<SeededOperator> {
  const operatorId = await insertOperator(sql, label);
  const rows = await sql.unsafe(
    `INSERT INTO "public"."platform_members" ("operator_user_id", "role", "active")
     VALUES ($1, $2::platform_member_role, $3)
     RETURNING "id"`,
    [operatorId, role, active],
  );
  return { operatorId, membershipId: numericId(rows[0]?.id) };
}

async function suspendOperator(
  sql: SqlExecutor,
  targetOperatorId: number,
  actorOperatorId: number,
) {
  await sql.unsafe(
    `UPDATE "public"."operator_users"
     SET "suspended_at" = now(),
         "suspension_reason" = 'isolated test',
         "suspended_by_operator_id" = $2
     WHERE "id" = $1`,
    [targetOperatorId, actorOperatorId],
  );
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

async function membershipIsActive(sql: SqlExecutor, membershipId: number) {
  const rows = await sql.unsafe(
    'SELECT "active" FROM "public"."platform_members" WHERE "id" = $1',
    [membershipId],
  );
  return rows[0]?.active === true;
}

async function membershipExists(sql: SqlExecutor, membershipId: number) {
  const rows = await sql.unsafe(
    'SELECT EXISTS (SELECT 1 FROM "public"."platform_members" WHERE "id" = $1) AS "exists"',
    [membershipId],
  );
  return rows[0]?.exists === true;
}

async function platformMembershipState(
  sql: SqlExecutor,
  operatorUserId: number,
) {
  const rows = await sql.unsafe(
    `SELECT count(*) AS "count", bool_and("active") AS "active"
     FROM "public"."platform_members"
     WHERE "operator_user_id" = $1`,
    [operatorUserId],
  );
  return {
    count: Number(rows[0]?.count),
    active: rows[0]?.active === true,
  };
}

async function operatorIsSuspended(sql: SqlExecutor, operatorId: number) {
  const rows = await sql.unsafe(
    'SELECT "suspended_at" IS NOT NULL AS "suspended" FROM "public"."operator_users" WHERE "id" = $1',
    [operatorId],
  );
  return rows[0]?.suspended === true;
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

async function auditCount(
  sql: SqlExecutor,
  outcome: "success" | "failure",
) {
  const rows = await sql.unsafe(
    `SELECT count(*) AS "count"
     FROM "public"."operator_audit_log"
     WHERE "action" LIKE 'platform_role.%'
       AND "payload"->>'outcome' = $1`,
    [outcome],
  );
  return Number(rows[0]?.count);
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

function postgresFailure(code: string) {
  return Object.assign(new Error("isolated retry signal"), { code });
}
