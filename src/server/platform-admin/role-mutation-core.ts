import { platformMemberRoleValues } from "../../db/schema.ts";
import { OperatorApiError } from "../operator-api/errors.ts";
import {
  createPlatformAuditRecord,
  type PlatformAuditAction,
  type PlatformAuditEvent,
  type PlatformAuditRecord,
  type PlatformAuditTargetType,
} from "./audit-core.ts";
import type { PlatformRole } from "./policy.ts";

export type GrantPlatformMembershipInput = {
  operatorUserId: number;
  role: PlatformRole;
};

export type ChangePlatformMembershipRoleInput = {
  membershipId: number;
  expectedRole: PlatformRole;
  role: PlatformRole;
};

export type DeactivatePlatformMembershipInput = {
  membershipId: number;
};

export type RemovePlatformMembershipInput = {
  membershipId: number;
};

export type PlatformRoleMutationResult = {
  operation: "grant" | "reactivate" | "change" | "deactivate" | "remove";
  membership: {
    id: number;
    operatorUserId: number;
    role: PlatformRole;
    active: boolean;
  };
};

export type PlatformRoleMutationStoreOutcome =
  | { kind: "success"; result: PlatformRoleMutationResult }
  | { kind: "operator_not_found" }
  | { kind: "operator_inactive" }
  | { kind: "membership_not_found" }
  | { kind: "membership_active"; membershipId: number }
  | { kind: "membership_active"; operatorUserId: number }
  | { kind: "membership_inactive"; membershipId: number }
  | { kind: "role_mismatch"; membershipId: number }
  | { kind: "role_no_op"; membershipId: number }
  | { kind: "self_mutation"; membershipId: number };

export type PlatformRoleMutationTransactionStore = {
  grantOrReactivate(
    input: GrantPlatformMembershipInput,
  ): Promise<PlatformRoleMutationStoreOutcome>;
  changeRole(
    actorOperatorId: number,
    input: ChangePlatformMembershipRoleInput,
  ): Promise<PlatformRoleMutationStoreOutcome>;
  deactivate(
    actorOperatorId: number,
    input: DeactivatePlatformMembershipInput,
  ): Promise<PlatformRoleMutationStoreOutcome>;
  remove(
    actorOperatorId: number,
    input: RemovePlatformMembershipInput,
  ): Promise<PlatformRoleMutationStoreOutcome>;
  isEligiblePlatformOwner(operatorUserId: number): Promise<boolean>;
  insertAuditRecord(record: PlatformAuditRecord): Promise<void>;
};

export type VerifiedPlatformRoleMutationActor = {
  operatorId: number;
};

export type PlatformRoleMutationDependencies = {
  authorizeActor: () => Promise<VerifiedPlatformRoleMutationActor>;
  runTransaction: <T>(
    callback: (store: PlatformRoleMutationTransactionStore) => Promise<T>,
  ) => Promise<T>;
  isActorEligible: (operatorUserId: number) => Promise<boolean>;
  insertFailureAuditRecord: (record: PlatformAuditRecord) => Promise<void>;
  waitBeforeRetry: (milliseconds: number) => Promise<void>;
  retryDelayMilliseconds: (completedAttempts: number) => number;
};

type PlatformRoleMutationCommand =
  | { type: "grant"; input: GrantPlatformMembershipInput }
  | { type: "change"; input: ChangePlatformMembershipRoleInput }
  | { type: "deactivate"; input: DeactivatePlatformMembershipInput }
  | { type: "remove"; input: RemovePlatformMembershipInput };

type AuditedFailure = {
  error: OperatorApiError;
  event: PlatformAuditEvent;
};

const lastOwnerConstraint = "eligible_platform_owner_required";
const retryableSqlStates = new Set(["40001", "40P01"]);
const maximumTransactionAttempts = 3;
const maximumRetryDelayMilliseconds = 100;

class AuditedPlatformRoleMutationFailure extends Error {
  readonly failure: AuditedFailure;

  constructor(failure: AuditedFailure) {
    super(failure.error.message);
    this.name = "AuditedPlatformRoleMutationFailure";
    this.failure = failure;
  }
}

class ActorRevalidationFailure extends Error {
  constructor() {
    super("Platform role mutation actor is no longer eligible.");
    this.name = "ActorRevalidationFailure";
  }
}

class SuccessAuditFailure extends Error {
  constructor() {
    super("Required platform role success audit failed.");
    this.name = "SuccessAuditFailure";
  }
}

export async function grantOrReactivatePlatformMembershipWithDependencies(
  input: GrantPlatformMembershipInput,
  dependencies: PlatformRoleMutationDependencies,
): Promise<PlatformRoleMutationResult> {
  return executePlatformRoleMutation({ type: "grant", input }, dependencies);
}

export async function changePlatformMembershipRoleWithDependencies(
  input: ChangePlatformMembershipRoleInput,
  dependencies: PlatformRoleMutationDependencies,
): Promise<PlatformRoleMutationResult> {
  return executePlatformRoleMutation({ type: "change", input }, dependencies);
}

export async function deactivatePlatformMembershipWithDependencies(
  input: DeactivatePlatformMembershipInput,
  dependencies: PlatformRoleMutationDependencies,
): Promise<PlatformRoleMutationResult> {
  return executePlatformRoleMutation(
    { type: "deactivate", input },
    dependencies,
  );
}

export async function removePlatformMembershipWithDependencies(
  input: RemovePlatformMembershipInput,
  dependencies: PlatformRoleMutationDependencies,
): Promise<PlatformRoleMutationResult> {
  return executePlatformRoleMutation({ type: "remove", input }, dependencies);
}

async function executePlatformRoleMutation(
  command: PlatformRoleMutationCommand,
  dependencies: PlatformRoleMutationDependencies,
): Promise<PlatformRoleMutationResult> {
  validateCommand(command);
  const actor = await dependencies.authorizeActor();
  assertPositiveId(actor.operatorId);

  try {
    return await runTransactionWithRetry(command, actor, dependencies);
  } catch (caughtError) {
    let actorEligible: boolean;
    try {
      actorEligible = await dependencies.isActorEligible(actor.operatorId);
    } catch {
      throw mutationFailedError();
    }

    if (!actorEligible) {
      throw accessDeniedError();
    }

    const failure = mapMutationFailure(caughtError, command);

    if (failure instanceof AuditedPlatformRoleMutationFailure) {
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
  command: PlatformRoleMutationCommand,
  actor: VerifiedPlatformRoleMutationActor,
  dependencies: PlatformRoleMutationDependencies,
): Promise<PlatformRoleMutationResult> {
  for (let attempt = 1; attempt <= maximumTransactionAttempts; attempt += 1) {
    try {
      return await dependencies.runTransaction(async (store) => {
        if (!(await store.isEligiblePlatformOwner(actor.operatorId))) {
          throw new ActorRevalidationFailure();
        }

        const outcome = await executeStoreMutation(store, actor, command);
        const result = resolveStoreOutcome(outcome, command);

        if (!(await store.isEligiblePlatformOwner(actor.operatorId))) {
          throw new ActorRevalidationFailure();
        }

        const successRecord = createPlatformAuditRecord(
          actor.operatorId,
          createSuccessAuditEvent(result),
        );

        try {
          await store.insertAuditRecord(successRecord);
        } catch (auditError) {
          if (isRetryableDatabaseError(auditError)) {
            throw auditError;
          }
          throw new SuccessAuditFailure();
        }

        return result;
      });
    } catch (error) {
      if (!isRetryableDatabaseError(error)) {
        throw error;
      }

      if (attempt === maximumTransactionAttempts) {
        throw retryExhaustedError();
      }

      const requestedDelay = dependencies.retryDelayMilliseconds(attempt);
      await dependencies.waitBeforeRetry(boundRetryDelay(requestedDelay));
    }
  }

  throw retryExhaustedError();
}

function executeStoreMutation(
  store: PlatformRoleMutationTransactionStore,
  actor: VerifiedPlatformRoleMutationActor,
  command: PlatformRoleMutationCommand,
) {
  switch (command.type) {
    case "grant":
      return store.grantOrReactivate(command.input);
    case "change":
      return store.changeRole(actor.operatorId, command.input);
    case "deactivate":
      return store.deactivate(actor.operatorId, command.input);
    case "remove":
      return store.remove(actor.operatorId, command.input);
  }
}

function resolveStoreOutcome(
  outcome: PlatformRoleMutationStoreOutcome,
  command: PlatformRoleMutationCommand,
): PlatformRoleMutationResult {
  if (outcome.kind === "success") {
    return outcome.result;
  }

  if (outcome.kind === "operator_not_found") {
    throw new OperatorApiError(
      404,
      "OPERATOR_NOT_FOUND",
      "The target operator was not found.",
    );
  }

  if (outcome.kind === "membership_not_found") {
    throw new OperatorApiError(
      404,
      "PLATFORM_MEMBERSHIP_NOT_FOUND",
      "The platform membership was not found.",
    );
  }

  const target = auditTargetForOutcome(outcome, command);
  const operation = command.type;

  switch (outcome.kind) {
    case "operator_inactive":
      throw auditedFailure(
        new OperatorApiError(
          409,
          "TARGET_OPERATOR_INACTIVE",
          "The target operator is inactive.",
        ),
        command,
        target,
        "The target operator is inactive.",
      );
    case "membership_active":
      throw auditedFailure(
        new OperatorApiError(
          409,
          "PLATFORM_MEMBERSHIP_ACTIVE",
          "An active platform membership already exists.",
        ),
        command,
        target,
        "An active platform membership already exists.",
      );
    case "membership_inactive":
    case "role_mismatch":
      throw auditedFailure(
        new OperatorApiError(
          409,
          "PLATFORM_MEMBERSHIP_INVALID_STATE",
          "The platform membership is not in a valid state for this operation.",
        ),
        command,
        target,
        "The platform membership state does not allow this operation.",
      );
    case "role_no_op":
      throw auditedFailure(
        new OperatorApiError(
          409,
          "PLATFORM_ROLE_NO_OP",
          "The platform membership already has the requested role.",
        ),
        command,
        target,
        "The requested platform role is already assigned.",
      );
    case "self_mutation":
      throw auditedFailure(
        new OperatorApiError(
          409,
          "PLATFORM_ROLE_SELF_MUTATION",
          "A platform owner cannot mutate their own platform membership.",
        ),
        command,
        target,
        "A platform owner attempted a forbidden self-mutation.",
      );
    default:
      throw new OperatorApiError(
        409,
        "PLATFORM_ROLE_MUTATION_CONFLICT",
        `The platform role ${operation} operation could not be completed.`,
      );
  }
}

function mapMutationFailure(
  error: unknown,
  command: PlatformRoleMutationCommand,
): Error {
  if (
    error instanceof AuditedPlatformRoleMutationFailure ||
    error instanceof OperatorApiError
  ) {
    return error;
  }

  if (error instanceof ActorRevalidationFailure) {
    return accessDeniedError();
  }

  if (error instanceof SuccessAuditFailure) {
    return auditFailedError();
  }

  if (isLastEligibleOwnerGuardError(error)) {
    const target = auditTargetForCommand(command);
    return auditedFailure(
      new OperatorApiError(
        409,
        "LAST_ELIGIBLE_PLATFORM_OWNER",
        "At least one eligible platform owner must remain.",
      ),
      command,
      target,
      "The database rejected removal of the last eligible platform owner.",
    );
  }

  return mutationFailedError();
}

function auditedFailure(
  error: OperatorApiError,
  command: PlatformRoleMutationCommand,
  target: { type: PlatformAuditTargetType; id: string },
  reason: string,
) {
  return new AuditedPlatformRoleMutationFailure({
    error,
    event: {
      action: auditActionForCommand(command),
      targetType: target.type,
      targetId: target.id,
      outcome: "failure",
      summary: "Platform role mutation rejected.",
      reason,
      metadata: { operation: command.type },
    },
  });
}

function createSuccessAuditEvent(
  result: PlatformRoleMutationResult,
): PlatformAuditEvent {
  return {
    action: auditActionForOperation(result.operation),
    targetType: "platform_member",
    targetId: String(result.membership.id),
    outcome: "success",
    summary: "Platform role mutation completed.",
    metadata: {
      operation: result.operation,
      resultingRole: result.membership.role,
      membershipActive: result.membership.active,
    },
  };
}

function auditActionForCommand(
  command: PlatformRoleMutationCommand,
): PlatformAuditAction {
  return auditActionForOperation(command.type);
}

function auditActionForOperation(
  operation: PlatformRoleMutationResult["operation"] | PlatformRoleMutationCommand["type"],
): PlatformAuditAction {
  switch (operation) {
    case "grant":
    case "reactivate":
      return "platform_role.grant";
    case "change":
      return "platform_role.change";
    case "deactivate":
      return "platform_role.deactivate";
    case "remove":
      return "platform_role.remove";
  }
}

function auditTargetForOutcome(
  outcome: Exclude<PlatformRoleMutationStoreOutcome, { kind: "success" }>,
  command: PlatformRoleMutationCommand,
) {
  if (outcome.kind === "operator_inactive") {
    return command.type === "grant"
      ? {
          type: "operator_user" as const,
          id: String(command.input.operatorUserId),
        }
      : auditTargetForCommand(command);
  }

  if (
    outcome.kind === "membership_active" &&
    "operatorUserId" in outcome
  ) {
    return {
      type: "operator_user" as const,
      id: String(outcome.operatorUserId),
    };
  }

  if ("membershipId" in outcome) {
    return {
      type: "platform_member" as const,
      id: String(outcome.membershipId),
    };
  }

  return auditTargetForCommand(command);
}

function auditTargetForCommand(command: PlatformRoleMutationCommand) {
  if (command.type === "grant") {
    return {
      type: "operator_user" as const,
      id: String(command.input.operatorUserId),
    };
  }
  return {
    type: "platform_member" as const,
    id: String(command.input.membershipId),
  };
}

function validateCommand(command: PlatformRoleMutationCommand): void {
  if (command.type === "grant") {
    assertPositiveId(command.input.operatorUserId);
    assertPlatformRole(command.input.role);
    return;
  }

  assertPositiveId(command.input.membershipId);
  if (command.type === "change") {
    assertPlatformRole(command.input.expectedRole);
    assertPlatformRole(command.input.role);
  }
}

function assertPositiveId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new OperatorApiError(
      400,
      "INVALID_PLATFORM_ROLE_MUTATION_INPUT",
      "Platform role mutation input is invalid.",
    );
  }
}

function assertPlatformRole(value: PlatformRole): void {
  if (!platformMemberRoleValues.includes(value)) {
    throw new OperatorApiError(
      400,
      "INVALID_PLATFORM_ROLE_MUTATION_INPUT",
      "Platform role mutation input is invalid.",
    );
  }
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
    if (!current || typeof current !== "object") {
      return undefined;
    }
    const record = current as Record<string, unknown>;
    const value = record[property];
    if (typeof value === "string") {
      return value;
    }
    current = record.cause;
  }

  return undefined;
}

function boundRetryDelay(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(
    maximumRetryDelayMilliseconds,
    Math.max(0, Math.floor(value)),
  );
}

function retryExhaustedError() {
  return new OperatorApiError(
    409,
    "PLATFORM_ROLE_RETRY_EXHAUSTED",
    "The platform role mutation conflicted with another operation.",
  );
}

function auditFailedError() {
  return new OperatorApiError(
    503,
    "PLATFORM_AUDIT_FAILED",
    "The required audit record could not be written.",
  );
}

function accessDeniedError() {
  return new OperatorApiError(
    403,
    "PLATFORM_ACCESS_DENIED",
    "Platform access is not permitted.",
  );
}

function mutationFailedError() {
  return new OperatorApiError(
    503,
    "PLATFORM_ROLE_MUTATION_FAILED",
    "The platform role mutation could not be completed.",
  );
}
