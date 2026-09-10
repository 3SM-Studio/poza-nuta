import "server-only";

import { operatorAuditLog } from "../../db/schema.ts";
import { getDb } from "../db.ts";
import { requirePlatformAdminAccess } from "./guard.ts";
import {
  suspendOperatorWithDependencies,
  unlockOperatorWithDependencies,
  type PlatformSuspensionDependencies,
  type SuspendOperatorInput,
  type UnlockOperatorInput,
} from "./suspension-core.ts";
import {
  createPlatformSuspensionTransactionStore,
  findPlatformSuspensionActorAccess,
  findPlatformSuspensionTargetContext,
} from "./suspension-store.ts";

export async function suspendOperator(input: SuspendOperatorInput) {
  return suspendOperatorWithDependencies(input, productionDependencies);
}

export async function unlockOperator(input: UnlockOperatorInput) {
  return unlockOperatorWithDependencies(input, productionDependencies);
}

const productionDependencies: PlatformSuspensionDependencies = {
  authorizeActor: async () => {
    const session = await requirePlatformAdminAccess("users.suspend_non_owner");
    return { operatorId: session.operator.id };
  },
  runTransaction: (callback) =>
    getDb().transaction((transaction) =>
      callback(createPlatformSuspensionTransactionStore(transaction)),
    ),
  findActorAccess: (operatorUserId) =>
    findPlatformSuspensionActorAccess(getDb(), operatorUserId),
  findTargetContext: (operatorUserId) =>
    findPlatformSuspensionTargetContext(getDb(), operatorUserId),
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
