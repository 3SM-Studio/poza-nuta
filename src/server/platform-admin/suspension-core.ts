import { operatorSuspensionReasonMaxLength } from "../../db/schema.ts";
import { OperatorApiError } from "../operator-api/errors.ts";
import {
  createPlatformAuditRecord,
  PlatformAuditValidationError,
  type PlatformAuditEvent,
  type PlatformAuditRecord,
} from "./audit-core.ts";
import type { PlatformRole } from "./policy.ts";

export type SuspendOperatorInput = {
  operatorUserId: number;
  reason: string;
};

export type UnlockOperatorInput = {
  operatorUserId: number;
};

export type PlatformSuspensionResult = {
  operation: "suspend" | "unlock";
  operator: {
    id: number;
    suspendedAt: Date | null;
  };
};

export type PlatformSuspensionActorAccess = {
  role: PlatformRole;
};

export type PlatformSuspensionTargetContext = {
  isOwner: boolean;
};

export type PlatformSuspensionStoreOutcome =
  | {
      kind: "success";
      result: PlatformSuspensionResult;
      targetIsOwner: boolean;
    }
  | { kind: "operator_not_found" }
  | { kind: "operator_inactive"; targetIsOwner: boolean }
  | { kind: "already_suspended"; targetIsOwner: boolean }
  | { kind: "not_suspended"; targetIsOwner: boolean }
  | { kind: "self_mutation"; targetIsOwner: boolean }
  | { kind: "owner_permission_denied"; targetIsOwner: true };

export type PlatformSuspensionTransactionStore = {
  findActorAccess(
    operatorUserId: number,
  ): Promise<PlatformSuspensionActorAccess | null>;
  findTargetContext(
    operatorUserId: number,
  ): Promise<PlatformSuspensionTargetContext | null>;
  suspend(
    actorOperatorId: number,
    actorRole: PlatformRole,
    input: SuspendOperatorInput,
  ): Promise<PlatformSuspensionStoreOutcome>;
  unlock(
    actorOperatorId: number,
    actorRole: PlatformRole,
    input: UnlockOperatorInput,
  ): Promise<PlatformSuspensionStoreOutcome>;
  insertAuditRecord(record: PlatformAuditRecord): Promise<void>;
};

export type PlatformSuspensionDependencies = {
  authorizeActor: () => Promise<{ operatorId: number }>;
  runTransaction: <T>(
    callback: (store: PlatformSuspensionTransactionStore) => Promise<T>,
  ) => Promise<T>;
  findActorAccess: (
    operatorUserId: number,
  ) => Promise<PlatformSuspensionActorAccess | null>;
  findTargetContext: (
    operatorUserId: number,
  ) => Promise<PlatformSuspensionTargetContext | null>;
  insertFailureAuditRecord: (record: PlatformAuditRecord) => Promise<void>;
  waitBeforeRetry: (milliseconds: number) => Promise<void>;
  retryDelayMilliseconds: (completedAttempts: number) => number;
};

type SuspensionCommand =
  | { type: "suspend"; input: SuspendOperatorInput; normalizedReason: string }
  | { type: "unlock"; input: UnlockOperatorInput };

type AuditedFailure = {
  error: OperatorApiError;
  event: PlatformAuditEvent;
  targetIsOwner: boolean;
};

const lastOwnerConstraint = "eligible_platform_owner_required";
const retryableSqlStates = new Set(["40001", "40P01"]);
const maximumTransactionAttempts = 3;
const maximumRetryDelayMilliseconds = 100;
const auditValidationActorId = 1;

class AuditedPlatformSuspensionFailure extends Error {
  readonly failure: AuditedFailure;

  constructor(failure: AuditedFailure) {
    super(failure.error.message);
    this.name = "AuditedPlatformSuspensionFailure";
    this.failure = failure;
  }
}

class ActorRevalidationFailure extends Error {
  constructor() {
    super("Platform suspension actor is no longer authorized.");
    this.name = "ActorRevalidationFailure";
  }
}

class TargetPermissionFailure extends Error {
  constructor() {
    super("Platform suspension target is not permitted.");
    this.name = "TargetPermissionFailure";
  }
}

class SuccessAuditFailure extends Error {
  constructor() {
    super("Required platform suspension success audit failed.");
    this.name = "SuccessAuditFailure";
  }
}

export async function suspendOperatorWithDependencies(
  input: SuspendOperatorInput,
  dependencies: PlatformSuspensionDependencies,
): Promise<PlatformSuspensionResult> {
  const normalizedReason = validateSuspendInput(input);
  const command: SuspensionCommand = {
    type: "suspend",
    input,
    normalizedReason,
  };
  validateSuccessAuditEvent(command);
  return executePlatformSuspension(command, dependencies);
}

export async function unlockOperatorWithDependencies(
  input: UnlockOperatorInput,
  dependencies: PlatformSuspensionDependencies,
): Promise<PlatformSuspensionResult> {
  validateOperatorId(input.operatorUserId);
  const command: SuspensionCommand = { type: "unlock", input };
  validateSuccessAuditEvent(command);
  return executePlatformSuspension(command, dependencies);
}

async function executePlatformSuspension(
  command: SuspensionCommand,
  dependencies: PlatformSuspensionDependencies,
): Promise<PlatformSuspensionResult> {
  const actor = await dependencies.authorizeActor();
  validateActorId(actor.operatorId);
  const successRecord = createSuccessAuditRecord(actor.operatorId, command);

  try {
    return await runTransactionWithRetry(
      command,
      actor.operatorId,
      successRecord,
      dependencies,
    );
  } catch (caughtError) {
    let actorAccess: PlatformSuspensionActorAccess | null;
    try {
      actorAccess = await dependencies.findActorAccess(actor.operatorId);
    } catch {
      throw mutationFailedError();
    }

    if (!isGeneralSuspensionActor(actorAccess)) {
      throw accessDeniedError();
    }

    const targetIsOwnerFromFailure = targetOwnerRequirement(caughtError);
    let currentTarget: PlatformSuspensionTargetContext | null;
    try {
      currentTarget = await dependencies.findTargetContext(
        command.input.operatorUserId,
      );
    } catch {
      throw mutationFailedError();
    }

    if (
      caughtError instanceof TargetPermissionFailure ||
      !canMutateTarget(
        actorAccess.role,
        targetIsOwnerFromFailure || currentTarget?.isOwner === true,
      )
    ) {
      throw accessDeniedError();
    }

    const failure = mapMutationFailure(caughtError, command, currentTarget);

    if (failure instanceof AuditedPlatformSuspensionFailure) {
      const record = createPlatformAuditRecord(
        actor.operatorId,
        failure.failure.event,
      );

      try {
        await dependencies.insertFailureAuditRecord(record);
      } catch {
        throw auditFailedError();
      }

      throw failure.failure.error;
    }

    throw failure;
  }
}

async function runTransactionWithRetry(
  command: SuspensionCommand,
  actorOperatorId: number,
  successRecord: PlatformAuditRecord,
  dependencies: PlatformSuspensionDependencies,
): Promise<PlatformSuspensionResult> {
  for (let attempt = 1; attempt <= maximumTransactionAttempts; attempt += 1) {
    try {
      return await dependencies.runTransaction(async (store) => {
        const actorAccess = await store.findActorAccess(actorOperatorId);
        if (!isGeneralSuspensionActor(actorAccess)) {
          throw new ActorRevalidationFailure();
        }

        const outcome = await executeStoreMutation(
          store,
          actorOperatorId,
          actorAccess.role,
          command,
        );
        const resolved = resolveStoreOutcome(outcome, command);

        const recheckedActor = await store.findActorAccess(actorOperatorId);
        const recheckedTarget = await store.findTargetContext(
          command.input.operatorUserId,
        );
        if (
          !isGeneralSuspensionActor(recheckedActor) ||
          !recheckedTarget ||
          !canMutateTarget(
            recheckedActor.role,
            resolved.targetIsOwner || recheckedTarget.isOwner,
          )
        ) {
          throw new ActorRevalidationFailure();
        }

        try {
          await store.insertAuditRecord(successRecord);
        } catch (auditError) {
          if (isRetryableDatabaseError(auditError)) throw auditError;
          throw new SuccessAuditFailure();
        }

        return resolved.result;
      });
    } catch (error) {
      if (!isRetryableDatabaseError(error)) throw error;
      if (attempt === maximumTransactionAttempts) throw retryExhaustedError();

      const requestedDelay = dependencies.retryDelayMilliseconds(attempt);
      await dependencies.waitBeforeRetry(boundRetryDelay(requestedDelay));
    }
  }

  throw retryExhaustedError();
}

function executeStoreMutation(
  store: PlatformSuspensionTransactionStore,
  actorOperatorId: number,
  actorRole: PlatformRole,
  command: SuspensionCommand,
) {
  if (command.type === "suspend") {
    return store.suspend(actorOperatorId, actorRole, {
      operatorUserId: command.input.operatorUserId,
      reason: command.normalizedReason,
    });
  }
  return store.unlock(actorOperatorId, actorRole, command.input);
}

function resolveStoreOutcome(
  outcome: PlatformSuspensionStoreOutcome,
  command: SuspensionCommand,
): { result: PlatformSuspensionResult; targetIsOwner: boolean } {
  if (outcome.kind === "success") return outcome;
  if (outcome.kind === "operator_not_found") {
    throw operatorNotFoundError();
  }
  if (outcome.kind === "owner_permission_denied") {
    throw new TargetPermissionFailure();
  }

  switch (outcome.kind) {
    case "operator_inactive":
      throw auditedFailure(
        new OperatorApiError(
          409,
          "TARGET_OPERATOR_INACTIVE",
          "The target operator is inactive.",
        ),
        command,
        outcome.targetIsOwner,
        "The target operator is inactive.",
      );
    case "already_suspended":
      throw auditedFailure(
        new OperatorApiError(
          409,
          "OPERATOR_ALREADY_SUSPENDED",
          "The target operator is already suspended.",
        ),
        command,
        outcome.targetIsOwner,
        "The target operator is already suspended.",
      );
    case "not_suspended":
      throw auditedFailure(
        new OperatorApiError(
          409,
          "OPERATOR_NOT_SUSPENDED",
          "The target operator is not suspended.",
        ),
        command,
        outcome.targetIsOwner,
        "The target operator is not suspended.",
      );
    case "self_mutation":
      throw auditedFailure(
        new OperatorApiError(
          409,
          "OPERATOR_SELF_ACCESS_MUTATION",
          "An operator cannot change their own application access.",
        ),
        command,
        outcome.targetIsOwner,
        "An operator attempted a forbidden self access mutation.",
      );
  }
}

function mapMutationFailure(
  error: unknown,
  command: SuspensionCommand,
  currentTarget: PlatformSuspensionTargetContext | null,
): Error {
  if (
    error instanceof AuditedPlatformSuspensionFailure ||
    error instanceof OperatorApiError
  ) {
    return error;
  }
  if (error instanceof ActorRevalidationFailure) return accessDeniedError();
  if (error instanceof SuccessAuditFailure) return auditFailedError();
  if (isLastEligibleOwnerGuardError(error)) {
    if (!currentTarget) return operatorNotFoundError();
    return auditedFailure(
      new OperatorApiError(
        409,
        "LAST_ELIGIBLE_PLATFORM_OWNER",
        "At least one eligible platform owner must remain.",
      ),
      command,
      currentTarget.isOwner,
      "The database rejected suspension of the last eligible platform owner.",
    );
  }
  return mutationFailedError();
}

function auditedFailure(
  error: OperatorApiError,
  command: SuspensionCommand,
  targetIsOwner: boolean,
  reason: string,
) {
  return new AuditedPlatformSuspensionFailure({
    error,
    targetIsOwner,
    event: {
      action: auditAction(command),
      targetType: "operator_user",
      targetId: String(command.input.operatorUserId),
      outcome: "failure",
      summary: "Operator application access mutation rejected.",
      reason,
      metadata: { operation: command.type },
    },
  });
}

function validateSuspendInput(input: SuspendOperatorInput): string {
  validateOperatorId(input.operatorUserId);
  if (typeof input.reason !== "string") throw invalidInputError();
  const normalized = input.reason.trim();
  if (
    normalized.length === 0 ||
    normalized.length > operatorSuspensionReasonMaxLength
  ) {
    throw invalidInputError();
  }
  return normalized;
}

function validateOperatorId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidInputError();
}

function validateActorId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw accessDeniedError();
}

function validateSuccessAuditEvent(command: SuspensionCommand): void {
  try {
    createPlatformAuditRecord(
      auditValidationActorId,
      successAuditEvent(command),
    );
  } catch (error) {
    if (error instanceof PlatformAuditValidationError) throw invalidInputError();
    throw error;
  }
}

function createSuccessAuditRecord(
  actorOperatorId: number,
  command: SuspensionCommand,
) {
  return createPlatformAuditRecord(
    actorOperatorId,
    successAuditEvent(command),
  );
}

function successAuditEvent(command: SuspensionCommand): PlatformAuditEvent {
  return {
    action: auditAction(command),
    targetType: "operator_user",
    targetId: String(command.input.operatorUserId),
    outcome: "success",
    summary: "Operator application access mutation completed.",
    ...(command.type === "suspend"
      ? { reason: command.normalizedReason }
      : {}),
    metadata: { operation: command.type },
  };
}

function auditAction(command: SuspensionCommand) {
  return command.type === "suspend" ? "user.suspend" : "user.unlock";
}

function isGeneralSuspensionActor(
  access: PlatformSuspensionActorAccess | null,
): access is PlatformSuspensionActorAccess {
  return access?.role === "platform_owner" || access?.role === "platform_admin";
}

function canMutateTarget(role: PlatformRole, targetIsOwner: boolean) {
  return !targetIsOwner || role === "platform_owner";
}

function targetOwnerRequirement(error: unknown) {
  return (
    error instanceof AuditedPlatformSuspensionFailure &&
    error.failure.targetIsOwner
  );
}

function isRetryableDatabaseError(error: unknown): boolean {
  return retryableSqlStates.has(databaseErrorProperty(error, "code") ?? "");
}

function isLastEligibleOwnerGuardError(error: unknown): boolean {
  return (
    databaseErrorProperty(error, "code") === "23514" &&
    databaseErrorProperty(error, "constraint_name") === lastOwnerConstraint
  );
}

function databaseErrorProperty(
  error: unknown,
  property: "code" | "constraint_name",
): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return undefined;
    const record = current as Record<string, unknown>;
    const value = record[property];
    if (typeof value === "string") return value;
    current = record.cause;
  }
  return undefined;
}

function boundRetryDelay(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(
    maximumRetryDelayMilliseconds,
    Math.max(0, Math.floor(value)),
  );
}

function invalidInputError() {
  return new OperatorApiError(
    400,
    "INVALID_OPERATOR_SUSPENSION_INPUT",
    "Operator suspension input is invalid.",
  );
}

function operatorNotFoundError() {
  return new OperatorApiError(
    404,
    "OPERATOR_NOT_FOUND",
    "The target operator was not found.",
  );
}

function accessDeniedError() {
  return new OperatorApiError(
    403,
    "PLATFORM_ACCESS_DENIED",
    "Platform access is not permitted.",
  );
}

function retryExhaustedError() {
  return new OperatorApiError(
    409,
    "OPERATOR_SUSPENSION_RETRY_EXHAUSTED",
    "The operator suspension mutation conflicted with another operation.",
  );
}

function auditFailedError() {
  return new OperatorApiError(
    503,
    "PLATFORM_AUDIT_FAILED",
    "The required audit record could not be written.",
  );
}

function mutationFailedError() {
  return new OperatorApiError(
    503,
    "OPERATOR_SUSPENSION_MUTATION_FAILED",
    "The operator suspension mutation could not be completed.",
  );
}
