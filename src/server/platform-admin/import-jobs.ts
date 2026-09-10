import "server-only";

import { getDb } from "../db.ts";
import { requirePlatformAdminAccess } from "./guard.ts";
import {
  enqueueImportJobWithDependencies,
  requestImportCancellationWithDependencies,
  type EnqueueImportJobInput,
  type ImportJobMutationDependencies,
  type RequestImportCancellationInput,
} from "./import-job-core.ts";
import { createImportJobTransactionStore } from "./import-job-store.ts";

export function enqueueImportJob(input: EnqueueImportJobInput) {
  return enqueueImportJobWithDependencies(input, productionDependencies);
}

export function requestImportCancellation(
  input: RequestImportCancellationInput,
) {
  return requestImportCancellationWithDependencies(input, productionDependencies);
}

const productionDependencies: ImportJobMutationDependencies = {
  authorizeActor: async (permission) => {
    const session = await requirePlatformAdminAccess(permission);
    return { operatorId: session.operator.id };
  },
  runTransaction: (callback) =>
    getDb().transaction((transaction) =>
      callback(createImportJobTransactionStore(transaction)),
    ),
  waitBeforeRetry: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  retryDelayMilliseconds: (completedAttempts) => {
    const exponential = 10 * 2 ** (completedAttempts - 1);
    return exponential + Math.floor(Math.random() * 6);
  },
};
