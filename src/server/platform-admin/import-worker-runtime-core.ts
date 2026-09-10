import type {
  ISingCheckpointPhase,
  ISingImportOutcome,
  ISingImportSummary,
  SafeISingFailure,
} from "../../db/ising-import-adapter.ts";
import { toImportJobProgress } from "../../db/ising-import-adapter.ts";
import type {
  ClaimBoundInput,
  ImportJobClaim,
  ImportJobProgress,
} from "./import-worker-core.ts";

export type ImportWorkerCycleResult =
  | "idle"
  | "succeeded"
  | "cancelled"
  | "failed"
  | "stopped"
  | "retry_pending"
  | "claim_lost";

export type ImportWorkerRuntimeServices = {
  assertWorkerIdentity(): Promise<void>;
  recoverExpiredImportJobs(): Promise<number>;
  claimNextImportJob(): Promise<ImportJobClaim | null>;
  checkpointImportJob(
    input: ClaimBoundInput,
  ): Promise<"continue" | "cancelled">;
  updateImportJobProgress(input: ClaimBoundInput & ImportJobProgress): Promise<void>;
  completeImportJob(
    input: ClaimBoundInput & ImportJobProgress,
  ): Promise<"succeeded" | "cancelled">;
  failImportJob(
    input: ClaimBoundInput & {
      safeErrorCode: string;
      safeErrorSummary: string;
    },
  ): Promise<void>;
};

export type ImportWorkerRuntimeDependencies = {
  services: ImportWorkerRuntimeServices;
  executeISing(input: {
    claim: ImportJobClaim;
    checkpoint(
      phase: ISingCheckpointPhase,
      progress: ISingImportSummary,
    ): Promise<"continue" | "cancelled" | "stopped">;
  }): Promise<ISingImportOutcome>;
  classifyISingFailure(error: unknown): SafeISingFailure;
  isStopping(): boolean;
  wait(milliseconds: number): Promise<void>;
  random(): number;
};

export type RunImportWorkerOptions = {
  once: boolean;
  pollingIntervalMs: number;
  pollingJitterMs: number;
};

export async function runImportWorkerCycle(
  dependencies: ImportWorkerRuntimeDependencies,
): Promise<ImportWorkerCycleResult> {
  await dependencies.services.assertWorkerIdentity();
  await dependencies.services.recoverExpiredImportJobs();
  if (dependencies.isStopping()) return "stopped";

  await dependencies.services.assertWorkerIdentity();
  const claim = await dependencies.services.claimNextImportJob();
  if (!claim) return "idle";
  if (claim.source !== "ising") {
    throw new Error("The iSing worker claimed an unsupported import source.");
  }

  const claimInput = {
    importJobId: claim.id,
    claimToken: claim.claimToken,
  };
  let persistedProgress = claim.progress;

  try {
    const outcome = await dependencies.executeISing({
      claim,
      checkpoint: async (phase, summary) => {
        if (phase !== "after_batch" && dependencies.isStopping()) {
          return "stopped";
        }
        if (phase === "after_batch") {
          const nextProgress = toImportJobProgress(summary);
          if (progressDoesNotRegress(nextProgress, persistedProgress)) {
            await dependencies.services.updateImportJobProgress({
              ...claimInput,
              ...nextProgress,
            });
            persistedProgress = nextProgress;
          }
        }
        const checkpoint =
          await dependencies.services.checkpointImportJob(claimInput);
        if (checkpoint === "cancelled") return "cancelled";
        return dependencies.isStopping() ? "stopped" : "continue";
      },
    });

    if (outcome.status === "cancelled") return "cancelled";
    if (outcome.status === "stopped") return "stopped";

    const finalProgress = toImportJobProgress(outcome.summary);
    if (!progressDoesNotRegress(finalProgress, persistedProgress)) {
      throw new Error("The restarted iSing adapter did not reach saved progress.");
    }
    return await dependencies.services.completeImportJob({
      ...claimInput,
      ...finalProgress,
    });
  } catch (error) {
    if (isClaimLost(error)) return "claim_lost";
    if (isRetryableWorkerServiceFailure(error)) return "retry_pending";
    const failure = dependencies.classifyISingFailure(error);
    if (failure.kind === "transient") return "retry_pending";
    try {
      await dependencies.services.failImportJob({
        ...claimInput,
        safeErrorCode: failure.safeErrorCode,
        safeErrorSummary: failure.safeErrorSummary,
      });
      return "failed";
    } catch (failureError) {
      if (isClaimLost(failureError)) return "claim_lost";
      throw failureError;
    }
  }
}

export async function runImportWorker(
  options: RunImportWorkerOptions,
  dependencies: ImportWorkerRuntimeDependencies,
): Promise<ImportWorkerCycleResult> {
  validateRuntimeOptions(options);
  let lastResult: ImportWorkerCycleResult = "idle";

  do {
    lastResult = await runImportWorkerCycle(dependencies);
    if (options.once || lastResult === "stopped" || dependencies.isStopping()) {
      return lastResult;
    }
    await dependencies.wait(pollingDelay(options, dependencies.random()));
  } while (!dependencies.isStopping());

  return "stopped";
}

function validateRuntimeOptions(options: RunImportWorkerOptions): void {
  if (
    !Number.isSafeInteger(options.pollingIntervalMs) ||
    options.pollingIntervalMs < 100 ||
    options.pollingIntervalMs > 60_000 ||
    !Number.isSafeInteger(options.pollingJitterMs) ||
    options.pollingJitterMs < 0 ||
    options.pollingJitterMs > options.pollingIntervalMs
  ) {
    throw new Error("The import worker polling configuration is invalid.");
  }
}

function pollingDelay(options: RunImportWorkerOptions, random: number): number {
  const normalizedRandom = Number.isFinite(random)
    ? Math.min(1, Math.max(0, random))
    : 0;
  return (
    options.pollingIntervalMs +
    Math.floor(options.pollingJitterMs * normalizedRandom)
  );
}

function isClaimLost(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "IMPORT_JOB_CLAIM_LOST"
  );
}

function isRetryableWorkerServiceFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return (
    error.code === "IMPORT_WORKER_RETRY_EXHAUSTED" ||
    error.code === "PLATFORM_AUDIT_FAILED"
  );
}

function progressDoesNotRegress(
  next: ImportJobProgress,
  current: ImportJobProgress,
) {
  return (
    next.totalCount >= current.totalCount &&
    next.processedCount >= current.processedCount &&
    next.importedCount >= current.importedCount &&
    next.skippedCount >= current.skippedCount &&
    next.errorCount >= current.errorCount
  );
}
