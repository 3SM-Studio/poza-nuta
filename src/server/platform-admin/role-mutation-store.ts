import { and, eq, isNull, sql } from "drizzle-orm";

import {
  operatorAuditLog,
  operatorUsers,
  platformMembers,
} from "../../db/schema.ts";
import type { PlatformRole } from "./policy.ts";
import type {
  ChangePlatformMembershipRoleInput,
  DeactivatePlatformMembershipInput,
  GrantPlatformMembershipInput,
  PlatformRoleMutationResult,
  PlatformRoleMutationStoreOutcome,
  PlatformRoleMutationTransactionStore,
  RemovePlatformMembershipInput,
} from "./role-mutation-core.ts";

type Database = typeof import("../db.ts").getDb extends () => infer T ? T : never;
export type PlatformRoleMutationTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

type GrantRow = {
  target_operator_id: number | string | null;
  target_operator_active: boolean | null;
  target_suspended: boolean | null;
  existing_membership_id: number | string | null;
  existing_membership_active: boolean | null;
  written_id: number | string | null;
  written_operator_user_id: number | string | null;
  written_role: string | null;
  written_active: boolean | null;
};

type MembershipMutationRow = {
  current_id: number | string | null;
  current_operator_user_id: number | string | null;
  current_role: string | null;
  current_active: boolean | null;
  written_id: number | string | null;
  written_operator_user_id: number | string | null;
  written_role: string | null;
  written_active: boolean | null;
};

export function createPlatformRoleMutationTransactionStore(
  transaction: PlatformRoleMutationTransaction,
): PlatformRoleMutationTransactionStore {
  return {
    grantOrReactivate: (input) => grantOrReactivate(transaction, input),
    changeRole: (actorOperatorId, input) =>
      changeRole(transaction, actorOperatorId, input),
    deactivate: (actorOperatorId, input) =>
      deactivate(transaction, actorOperatorId, input),
    remove: (actorOperatorId, input) =>
      remove(transaction, actorOperatorId, input),
    isEligiblePlatformOwner: (operatorUserId) =>
      isEligiblePlatformOwner(transaction, operatorUserId),
    insertAuditRecord: async (record) => {
      await transaction.insert(operatorAuditLog).values(record);
    },
  };
}

async function grantOrReactivate(
  transaction: PlatformRoleMutationTransaction,
  input: GrantPlatformMembershipInput,
): Promise<PlatformRoleMutationStoreOutcome> {
  const rows = await transaction.execute<GrantRow>(sql`
    WITH target_operator AS MATERIALIZED (
      SELECT
        ${operatorUsers.id} AS id,
        ${operatorUsers.active} AS active,
        ${operatorUsers.suspendedAt} IS NOT NULL AS suspended
      FROM ${operatorUsers}
      WHERE ${operatorUsers.id} = ${input.operatorUserId}
    ),
    existing_membership AS MATERIALIZED (
      SELECT
        ${platformMembers.id} AS id,
        ${platformMembers.active} AS active
      FROM ${platformMembers}
      WHERE ${platformMembers.operatorUserId} = ${input.operatorUserId}
    ),
    written_membership AS (
      INSERT INTO ${platformMembers} (
        ${sql.identifier("operator_user_id")},
        ${sql.identifier("role")},
        ${sql.identifier("active")}
      )
      SELECT id, ${input.role}::platform_member_role, true
      FROM target_operator
      WHERE active = true
      ON CONFLICT (${sql.identifier("operator_user_id")}) DO UPDATE
      SET
        ${sql.identifier("role")} = EXCLUDED.${sql.identifier("role")},
        ${sql.identifier("active")} = true,
        ${sql.identifier("updated_at")} = now()
      WHERE ${platformMembers.active} = false
      RETURNING
        ${platformMembers.id} AS id,
        ${platformMembers.operatorUserId} AS operator_user_id,
        ${platformMembers.role}::text AS role,
        ${platformMembers.active} AS active
    )
    SELECT
      (SELECT id FROM target_operator) AS target_operator_id,
      (SELECT active FROM target_operator) AS target_operator_active,
      (SELECT suspended FROM target_operator) AS target_suspended,
      (SELECT id FROM existing_membership) AS existing_membership_id,
      (SELECT active FROM existing_membership) AS existing_membership_active,
      (SELECT id FROM written_membership) AS written_id,
      (SELECT operator_user_id FROM written_membership) AS written_operator_user_id,
      (SELECT role FROM written_membership) AS written_role,
      (SELECT active FROM written_membership) AS written_active
  `);
  const row = rows[0];

  if (!row || row.target_operator_id === null) {
    return { kind: "operator_not_found" };
  }
  if (row.target_operator_active !== true) {
    return { kind: "operator_inactive" };
  }
  if (row.written_id !== null) {
    return {
      kind: "success",
      result: {
        operation:
          row.existing_membership_id === null ? "grant" : "reactivate",
        membership: membershipFromRow(row),
      },
    };
  }
  if (
    row.existing_membership_id !== null &&
    row.existing_membership_active === true
  ) {
    return {
      kind: "membership_active",
      membershipId: numericId(row.existing_membership_id),
    };
  }

  return {
    kind: "membership_active",
    operatorUserId: input.operatorUserId,
  };
}

async function changeRole(
  transaction: PlatformRoleMutationTransaction,
  actorOperatorId: number,
  input: ChangePlatformMembershipRoleInput,
): Promise<PlatformRoleMutationStoreOutcome> {
  const row = await mutateExistingMembership(
    transaction,
    sql`
      WITH current_membership AS MATERIALIZED (
        SELECT
          ${platformMembers.id} AS id,
          ${platformMembers.operatorUserId} AS operator_user_id,
          ${platformMembers.role}::text AS role,
          ${platformMembers.active} AS active
        FROM ${platformMembers}
        WHERE ${platformMembers.id} = ${input.membershipId}
      ),
      written_membership AS (
        UPDATE ${platformMembers}
        SET
          ${sql.identifier("role")} = ${input.role}::platform_member_role,
          ${sql.identifier("updated_at")} = now()
        WHERE ${platformMembers.id} = ${input.membershipId}
          AND ${platformMembers.active} = true
          AND ${platformMembers.role} = ${input.expectedRole}::platform_member_role
          AND ${platformMembers.role} <> ${input.role}::platform_member_role
          AND ${platformMembers.operatorUserId} <> ${actorOperatorId}
        RETURNING
          ${platformMembers.id} AS id,
          ${platformMembers.operatorUserId} AS operator_user_id,
          ${platformMembers.role}::text AS role,
          ${platformMembers.active} AS active
      )
      ${membershipMutationSelection}
    `,
  );

  const failure = classifyExistingMutationFailure(row, actorOperatorId);
  if (failure) return failure;
  if (row.current_role !== input.expectedRole) {
    return {
      kind: "role_mismatch",
      membershipId: numericId(row.current_id),
    };
  }
  if (row.current_role === input.role) {
    return {
      kind: "role_no_op",
      membershipId: numericId(row.current_id),
    };
  }

  return successFromMutationRow("change", row);
}

async function deactivate(
  transaction: PlatformRoleMutationTransaction,
  actorOperatorId: number,
  input: DeactivatePlatformMembershipInput,
): Promise<PlatformRoleMutationStoreOutcome> {
  const row = await mutateExistingMembership(
    transaction,
    sql`
      WITH current_membership AS MATERIALIZED (
        SELECT
          ${platformMembers.id} AS id,
          ${platformMembers.operatorUserId} AS operator_user_id,
          ${platformMembers.role}::text AS role,
          ${platformMembers.active} AS active
        FROM ${platformMembers}
        WHERE ${platformMembers.id} = ${input.membershipId}
      ),
      written_membership AS (
        UPDATE ${platformMembers}
        SET
          ${sql.identifier("active")} = false,
          ${sql.identifier("updated_at")} = now()
        WHERE ${platformMembers.id} = ${input.membershipId}
          AND ${platformMembers.active} = true
          AND ${platformMembers.operatorUserId} <> ${actorOperatorId}
        RETURNING
          ${platformMembers.id} AS id,
          ${platformMembers.operatorUserId} AS operator_user_id,
          ${platformMembers.role}::text AS role,
          ${platformMembers.active} AS active
      )
      ${membershipMutationSelection}
    `,
  );

  return (
    classifyExistingMutationFailure(row, actorOperatorId) ??
    successFromMutationRow("deactivate", row)
  );
}

async function remove(
  transaction: PlatformRoleMutationTransaction,
  actorOperatorId: number,
  input: RemovePlatformMembershipInput,
): Promise<PlatformRoleMutationStoreOutcome> {
  const row = await mutateExistingMembership(
    transaction,
    sql`
      WITH current_membership AS MATERIALIZED (
        SELECT
          ${platformMembers.id} AS id,
          ${platformMembers.operatorUserId} AS operator_user_id,
          ${platformMembers.role}::text AS role,
          ${platformMembers.active} AS active
        FROM ${platformMembers}
        WHERE ${platformMembers.id} = ${input.membershipId}
      ),
      written_membership AS (
        DELETE FROM ${platformMembers}
        WHERE ${platformMembers.id} = ${input.membershipId}
          AND ${platformMembers.active} = true
          AND ${platformMembers.operatorUserId} <> ${actorOperatorId}
        RETURNING
          ${platformMembers.id} AS id,
          ${platformMembers.operatorUserId} AS operator_user_id,
          ${platformMembers.role}::text AS role,
          false AS active
      )
      ${membershipMutationSelection}
    `,
  );

  return (
    classifyExistingMutationFailure(row, actorOperatorId) ??
    successFromMutationRow("remove", row)
  );
}

const membershipMutationSelection = sql`
  SELECT
    (SELECT id FROM current_membership) AS current_id,
    (SELECT operator_user_id FROM current_membership) AS current_operator_user_id,
    (SELECT role FROM current_membership) AS current_role,
    (SELECT active FROM current_membership) AS current_active,
    (SELECT id FROM written_membership) AS written_id,
    (SELECT operator_user_id FROM written_membership) AS written_operator_user_id,
    (SELECT role FROM written_membership) AS written_role,
    (SELECT active FROM written_membership) AS written_active
`;

async function mutateExistingMembership(
  transaction: PlatformRoleMutationTransaction,
  query: ReturnType<typeof sql>,
): Promise<MembershipMutationRow> {
  const rows = await transaction.execute<MembershipMutationRow>(query);
  const row = rows[0];
  if (!row) {
    throw new Error("Platform membership mutation returned no result.");
  }
  return row;
}

function classifyExistingMutationFailure(
  row: MembershipMutationRow,
  actorOperatorId: number,
): PlatformRoleMutationStoreOutcome | null {
  if (row.current_id === null) {
    return { kind: "membership_not_found" };
  }
  if (row.current_active !== true) {
    return {
      kind: "membership_inactive",
      membershipId: numericId(row.current_id),
    };
  }
  if (numericId(row.current_operator_user_id) === actorOperatorId) {
    return {
      kind: "self_mutation",
      membershipId: numericId(row.current_id),
    };
  }
  return null;
}

function successFromMutationRow(
  operation: "change" | "deactivate" | "remove",
  row: MembershipMutationRow,
): PlatformRoleMutationStoreOutcome {
  if (row.written_id === null) {
    return {
      kind: "role_mismatch",
      membershipId: numericId(row.current_id),
    };
  }
  return {
    kind: "success",
    result: {
      operation,
      membership: membershipFromRow(row),
    },
  };
}

function membershipFromRow(
  row: Pick<
    GrantRow | MembershipMutationRow,
    "written_id" | "written_operator_user_id" | "written_role" | "written_active"
  >,
): PlatformRoleMutationResult["membership"] {
  return {
    id: numericId(row.written_id),
    operatorUserId: numericId(row.written_operator_user_id),
    role: platformRole(row.written_role),
    active: row.written_active === true,
  };
}

function numericId(value: number | string | null): number {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error("Database returned an invalid platform membership ID.");
  }
  return normalized;
}

function platformRole(value: string | null): PlatformRole {
  switch (value) {
    case "platform_owner":
    case "platform_admin":
    case "support":
      return value;
  }

  throw new Error("Database returned an invalid platform membership role.");
}

export async function isEligiblePlatformOwner(
  transaction: Pick<PlatformRoleMutationTransaction, "select">,
  operatorUserId: number,
) {
  const [membership] = await transaction
    .select({ id: platformMembers.id })
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
        eq(platformMembers.role, "platform_owner"),
      ),
    )
    .limit(1);

  return Boolean(membership);
}
