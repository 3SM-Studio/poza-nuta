import "server-only";

import { operatorAuditLog } from "../../db/schema.ts";
import { getDb } from "../db.ts";
import { requirePlatformAdminAccess } from "./guard.ts";
import {
  changePlatformMembershipRoleWithDependencies,
  deactivatePlatformMembershipWithDependencies,
  grantOrReactivatePlatformMembershipWithDependencies,
  removePlatformMembershipWithDependencies,
  type ChangePlatformMembershipRoleInput,
  type DeactivatePlatformMembershipInput,
  type GrantPlatformMembershipInput,
  type PlatformRoleMutationDependencies,
  type RemovePlatformMembershipInput,
} from "./role-mutation-core.ts";
import {
  createPlatformRoleMutationTransactionStore,
  isEligiblePlatformOwner,
} from "./role-mutation-store.ts";

export async function grantOrReactivatePlatformMembership(
  input: GrantPlatformMembershipInput,
) {
  return grantOrReactivatePlatformMembershipWithDependencies(
    input,
    productionDependencies,
  );
}

export async function changePlatformMembershipRole(
  input: ChangePlatformMembershipRoleInput,
) {
  return changePlatformMembershipRoleWithDependencies(
    input,
    productionDependencies,
  );
}

export async function deactivatePlatformMembership(
  input: DeactivatePlatformMembershipInput,
) {
  return deactivatePlatformMembershipWithDependencies(
    input,
    productionDependencies,
  );
}

export async function removePlatformMembership(
  input: RemovePlatformMembershipInput,
) {
  return removePlatformMembershipWithDependencies(input, productionDependencies);
}

const productionDependencies: PlatformRoleMutationDependencies = {
  authorizeActor: async () => {
    const session = await requirePlatformAdminAccess(
      "platform_members.mutate_non_owner",
    );
    return { operatorId: session.operator.id };
  },
  runTransaction: (callback) =>
    getDb().transaction((transaction) =>
      callback(createPlatformRoleMutationTransactionStore(transaction)),
    ),
  isActorEligible: (operatorUserId) =>
    isEligiblePlatformOwner(getDb(), operatorUserId),
  insertFailureAuditRecord: async (record) => {
    await getDb().insert(operatorAuditLog).values(record);
  },
  waitBeforeRetry: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  retryDelayMilliseconds: (completedAttempts) => {
    const exponential = 10 * 2 ** (completedAttempts - 1);
    const jitter = Math.floor(Math.random() * 6);
    return exponential + jitter;
  },
};
