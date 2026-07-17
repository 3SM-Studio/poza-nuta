import { randomUUID } from "node:crypto";

import type { getDb } from "../db.ts";
import {
  checkpointImportJob,
  claimNextImportJob,
  completeImportJob,
  failImportJob,
  heartbeatImportJob,
  recoverExpiredImportJobs,
  updateImportJobProgress,
  type ClaimBoundInput,
  type CompleteImportJobInput,
  type FailImportJobInput,
  type ImportWorkerDependencies,
  type UpdateImportJobProgressInput,
} from "./import-worker-core.ts";
import { createImportWorkerTransactionStore } from "./import-worker-store.ts";

type Database = ReturnType<typeof getDb>;

export function createImportWorkerServices(database: Database) {
  const dependencies: ImportWorkerDependencies = {
    runTransaction: (callback) =>
      database.transaction((transaction) =>
        callback(createImportWorkerTransactionStore(transaction)),
      ),
    randomClaimToken: randomUUID,
    waitBeforeRetry: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    retryDelayMilliseconds: (completedAttempts) => {
      const exponential = 10 * 2 ** (completedAttempts - 1);
      return exponential + Math.floor(Math.random() * 6);
    },
  };

  return {
    claimNextImportJob: (supportedSources?: readonly ("ising" | "karafun")[]) =>
      claimNextImportJob(dependencies, supportedSources),
    checkpointImportJob: (input: ClaimBoundInput) =>
      checkpointImportJob(input, dependencies),
    heartbeatImportJob: (input: ClaimBoundInput) =>
      heartbeatImportJob(input, dependencies),
    updateImportJobProgress: (input: UpdateImportJobProgressInput) =>
      updateImportJobProgress(input, dependencies),
    completeImportJob: (input: CompleteImportJobInput) =>
      completeImportJob(input, dependencies),
    failImportJob: (input: FailImportJobInput) =>
      failImportJob(input, dependencies),
    recoverExpiredImportJobs: (limit?: number) =>
      recoverExpiredImportJobs(dependencies, limit),
  };
}
