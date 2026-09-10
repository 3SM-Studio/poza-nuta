import { and, eq, isNull, sql } from "drizzle-orm";

import {
  operatorAuditLog,
  operatorUsers,
  platformMembers,
} from "../../db/schema.ts";
import type { PlatformRole } from "./policy.ts";
import type {
  PlatformSuspensionActorAccess,
  PlatformSuspensionStoreOutcome,
  PlatformSuspensionTargetContext,
  PlatformSuspensionTransactionStore,
  SuspendOperatorInput,
  UnlockOperatorInput,
} from "./suspension-core.ts";

type Database = typeof import("../db.ts").getDb extends () => infer T ? T : never;
export type PlatformSuspensionTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

type MutationRow = {
  target_id: number | string | null;
  target_active: boolean | null;
  target_suspended: boolean | null;
  target_is_owner: boolean | null;
  written_id: number | string | null;
  written_suspended_at: Date | string | null;
};

export function createPlatformSuspensionTransactionStore(
  transaction: PlatformSuspensionTransaction,
): PlatformSuspensionTransactionStore {
  return {
    findActorAccess: (operatorUserId) =>
      findPlatformSuspensionActorAccess(transaction, operatorUserId),
    findTargetContext: (operatorUserId) =>
      findPlatformSuspensionTargetContext(transaction, operatorUserId),
    suspend: (actorOperatorId, actorRole, input) =>
      suspend(transaction, actorOperatorId, actorRole, input),
    unlock: (actorOperatorId, actorRole, input) =>
      unlock(transaction, actorOperatorId, actorRole, input),
    insertAuditRecord: async (record) => {
      await transaction.insert(operatorAuditLog).values(record);
    },
  };
}

export async function findPlatformSuspensionActorAccess(
  database: Pick<PlatformSuspensionTransaction, "select">,
  operatorUserId: number,
): Promise<PlatformSuspensionActorAccess | null> {
  const [membership] = await database
    .select({ role: platformMembers.role })
    .from(platformMembers)
    .innerJoin(
      operatorUsers,
      eq(operatorUsers.id, platformMembers.operatorUserId),
    )
    .where(
      and(
        eq(operatorUsers.id, operatorUserId),
        eq(operatorUsers.active, true),
        isNull(operatorUsers.suspendedAt),
        eq(platformMembers.active, true),
      ),
    )
    .limit(1);

  return membership ?? null;
}

export async function findPlatformSuspensionTargetContext(
  database: Pick<PlatformSuspensionTransaction, "select">,
  operatorUserId: number,
): Promise<PlatformSuspensionTargetContext | null> {
  const [target] = await database
    .select({
      isOwner: sql<boolean>`COALESCE(
        bool_or(
          ${platformMembers.active} = true
          AND ${platformMembers.role} = 'platform_owner'
        ),
        false
      )`,
    })
    .from(operatorUsers)
    .leftJoin(
      platformMembers,
      eq(platformMembers.operatorUserId, operatorUsers.id),
    )
    .where(eq(operatorUsers.id, operatorUserId))
    .groupBy(operatorUsers.id)
    .limit(1);

  return target ?? null;
}

async function suspend(
  transaction: PlatformSuspensionTransaction,
  actorOperatorId: number,
  actorRole: PlatformRole,
  input: SuspendOperatorInput,
): Promise<PlatformSuspensionStoreOutcome> {
  const rows = await transaction.execute<MutationRow>(sql`
    WITH locked_target AS MATERIALIZED (
      SELECT
        ${operatorUsers.id} AS id,
        ${operatorUsers.active} AS active,
        ${operatorUsers.suspendedAt} IS NOT NULL AS suspended
      FROM ${operatorUsers}
      WHERE ${operatorUsers.id} = ${input.operatorUserId}
      FOR UPDATE
    ),
    target_operator AS MATERIALIZED (
      SELECT
        locked_target.id,
        locked_target.active,
        locked_target.suspended,
        COALESCE(
          bool_or(
            ${platformMembers.active} = true
            AND ${platformMembers.role} = 'platform_owner'
          ),
          false
        ) AS target_is_owner
      FROM locked_target
      LEFT JOIN ${platformMembers}
        ON ${platformMembers.operatorUserId} = locked_target.id
      GROUP BY locked_target.id, locked_target.active, locked_target.suspended
    ),
    written_operator AS (
      UPDATE ${operatorUsers}
      SET
        ${sql.identifier("suspended_at")} = now(),
        ${sql.identifier("suspension_reason")} = ${input.reason},
        ${sql.identifier("suspended_by_operator_id")} = ${actorOperatorId},
        ${sql.identifier("updated_at")} = now()
      FROM target_operator
      WHERE ${operatorUsers.id} = target_operator.id
        AND ${operatorUsers.active} = true
        AND ${operatorUsers.suspendedAt} IS NULL
        AND target_operator.active = true
        AND target_operator.suspended = false
        AND ${operatorUsers.id} <> ${actorOperatorId}
        AND (
          ${actorRole === "platform_owner"}
          OR target_operator.target_is_owner = false
        )
      RETURNING
        ${operatorUsers.id} AS id,
        ${operatorUsers.suspendedAt} AS suspended_at
    )
    SELECT
      (SELECT id FROM target_operator) AS target_id,
      (SELECT active FROM target_operator) AS target_active,
      (SELECT suspended FROM target_operator) AS target_suspended,
      (SELECT target_is_owner FROM target_operator) AS target_is_owner,
      (SELECT id FROM written_operator) AS written_id,
      (SELECT suspended_at FROM written_operator) AS written_suspended_at
  `);

  return classifyMutation(
    rows[0],
    actorOperatorId,
    actorRole,
    input.operatorUserId,
    "suspend",
  );
}

async function unlock(
  transaction: PlatformSuspensionTransaction,
  actorOperatorId: number,
  actorRole: PlatformRole,
  input: UnlockOperatorInput,
): Promise<PlatformSuspensionStoreOutcome> {
  const rows = await transaction.execute<MutationRow>(sql`
    WITH locked_target AS MATERIALIZED (
      SELECT
        ${operatorUsers.id} AS id,
        ${operatorUsers.active} AS active,
        ${operatorUsers.suspendedAt} IS NOT NULL AS suspended
      FROM ${operatorUsers}
      WHERE ${operatorUsers.id} = ${input.operatorUserId}
      FOR UPDATE
    ),
    target_operator AS MATERIALIZED (
      SELECT
        locked_target.id,
        locked_target.active,
        locked_target.suspended,
        COALESCE(
          bool_or(
            ${platformMembers.active} = true
            AND ${platformMembers.role} = 'platform_owner'
          ),
          false
        ) AS target_is_owner
      FROM locked_target
      LEFT JOIN ${platformMembers}
        ON ${platformMembers.operatorUserId} = locked_target.id
      GROUP BY locked_target.id, locked_target.active, locked_target.suspended
    ),
    written_operator AS (
      UPDATE ${operatorUsers}
      SET
        ${sql.identifier("suspended_at")} = NULL,
        ${sql.identifier("suspension_reason")} = NULL,
        ${sql.identifier("suspended_by_operator_id")} = NULL,
        ${sql.identifier("updated_at")} = now()
      FROM target_operator
      WHERE ${operatorUsers.id} = target_operator.id
        AND ${operatorUsers.active} = true
        AND ${operatorUsers.suspendedAt} IS NOT NULL
        AND target_operator.active = true
        AND target_operator.suspended = true
        AND ${operatorUsers.id} <> ${actorOperatorId}
        AND (
          ${actorRole === "platform_owner"}
          OR target_operator.target_is_owner = false
        )
      RETURNING
        ${operatorUsers.id} AS id,
        ${operatorUsers.suspendedAt} AS suspended_at
    )
    SELECT
      (SELECT id FROM target_operator) AS target_id,
      (SELECT active FROM target_operator) AS target_active,
      (SELECT suspended FROM target_operator) AS target_suspended,
      (SELECT target_is_owner FROM target_operator) AS target_is_owner,
      (SELECT id FROM written_operator) AS written_id,
      (SELECT suspended_at FROM written_operator) AS written_suspended_at
  `);

  return classifyMutation(
    rows[0],
    actorOperatorId,
    actorRole,
    input.operatorUserId,
    "unlock",
  );
}

function classifyMutation(
  row: MutationRow | undefined,
  actorOperatorId: number,
  actorRole: PlatformRole,
  targetOperatorId: number,
  operation: "suspend" | "unlock",
): PlatformSuspensionStoreOutcome {
  if (!row || row.target_id === null) return { kind: "operator_not_found" };
  const targetIsOwner = row.target_is_owner === true;
  if (row.target_active !== true) return { kind: "operator_inactive", targetIsOwner };
  if (numericId(row.target_id) === actorOperatorId) {
    return { kind: "self_mutation", targetIsOwner };
  }
  if (
    targetIsOwner &&
    actorRole !== "platform_owner" &&
    row.written_id === null
  ) {
    return { kind: "owner_permission_denied", targetIsOwner: true };
  }
  if (row.written_id === null) {
    return operation === "suspend"
      ? { kind: "already_suspended", targetIsOwner }
      : { kind: "not_suspended", targetIsOwner };
  }

  return {
    kind: "success",
    targetIsOwner,
    result: {
      operation,
      operator: {
        id: targetOperatorId,
        suspendedAt: normalizeTimestamp(row.written_suspended_at),
      },
    },
  };
}

function numericId(value: number | string): number {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error("Database returned an invalid operator ID.");
  }
  return normalized;
}

function normalizeTimestamp(value: Date | string | null): Date | null {
  if (value === null) return null;
  const normalized = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(normalized.getTime())) {
    throw new Error("Database returned an invalid suspension timestamp.");
  }
  return normalized;
}
