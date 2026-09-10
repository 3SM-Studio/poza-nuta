import { describe, expect, it, vi } from "vitest";

import { OperatorApiError } from "@/server/operator-api/errors";
import type { PlatformAuditRecord } from "@/server/platform-admin/audit-core";
import type { PlatformRole } from "@/server/platform-admin/policy";
import {
  suspendOperatorWithDependencies,
  unlockOperatorWithDependencies,
  type PlatformSuspensionActorAccess,
  type PlatformSuspensionDependencies,
  type PlatformSuspensionStoreOutcome,
  type PlatformSuspensionTransactionStore,
} from "@/server/platform-admin/suspension-core";

const actorOperatorId = 11;
const targetOperatorId = 22;
const suspendedAt = new Date("2026-07-16T10:00:00.000Z");

describe("platform suspension role and target policy", () => {
  it.each([
    ["platform_owner", false],
    ["platform_admin", false],
    ["platform_owner", true],
  ] as const)("allows %s to suspend target owner=%s", async (role, targetIsOwner) => {
    const harness = createHarness({ actorRole: role, targetIsOwner });

    const result = await suspendOperatorWithDependencies(
      { operatorUserId: targetOperatorId, reason: "  Policy violation  " },
      harness.dependencies,
    );

    expect(result).toEqual({
      operation: "suspend",
      operator: { id: targetOperatorId, suspendedAt },
    });
    expect(harness.successAudits()).toHaveLength(1);
    expect(harness.successAudits()[0]).toMatchObject({
      operatorId: actorOperatorId,
      action: "user.suspend",
      entityId: String(targetOperatorId),
      payload: {
        targetType: "operator_user",
        outcome: "success",
        reason: "Policy violation",
        metadata: { operation: "suspend" },
      },
    });
  });

  it.each(["suspend", "unlock"] as const)(
    "denies an admin attempting to %s an owner without mutation or target audit",
    async (operation) => {
      const harness = createHarness({
        actorRole: "platform_admin",
        targetIsOwner: true,
        outcomes: [{ kind: "owner_permission_denied", targetIsOwner: true }],
      });

      await expect(execute(operation, targetOperatorId, harness)).rejects.toMatchObject(
        { code: "PLATFORM_ACCESS_DENIED" },
      );
      expect(harness.committedMutationCount()).toBe(0);
      expect(harness.allAudits()).toHaveLength(0);
    },
  );

  it.each(["suspend", "unlock"] as const)(
    "denies support %s before opening a transaction",
    async (operation) => {
      const harness = createHarness({ actorRole: "support" });

      await expect(execute(operation, targetOperatorId, harness)).rejects.toMatchObject(
        { code: "PLATFORM_ACCESS_DENIED" },
      );
      expect(harness.runTransaction).not.toHaveBeenCalled();
    },
  );

  it.each(["suspend", "unlock"] as const)(
    "rejects self-%s and writes failure audit after rollback",
    async (operation) => {
      const harness = createHarness({
        targetOperatorId: actorOperatorId,
        targetIsOwner: true,
        outcomes: [{ kind: "self_mutation", targetIsOwner: true }],
      });

      await expect(execute(operation, actorOperatorId, harness)).rejects.toMatchObject(
        { code: "OPERATOR_SELF_ACCESS_MUTATION" },
      );
      expect(harness.events).toEqual([
        "transaction:start",
        "transaction:rollback",
        "audit:failure",
      ]);
      expect(harness.committedMutationCount()).toBe(0);
    },
  );
});

describe("suspension reason validation", () => {
  it.each(["", "   ", "a".repeat(501), "Bearer secret-value", "user@example.com"])(
    "rejects invalid or sensitive reason without authorization: %s",
    async (reason) => {
      const harness = createHarness();
      await expect(
        suspendOperatorWithDependencies(
          { operatorUserId: targetOperatorId, reason },
          harness.dependencies,
        ),
      ).rejects.toMatchObject({
        status: 400,
        code: "INVALID_OPERATOR_SUSPENSION_INPUT",
      });
      expect(harness.authorizeActor).not.toHaveBeenCalled();
    },
  );

  it.each(["a", "a".repeat(500)])(
    "accepts normalized reason boundary length %s",
    async (reason) => {
      const harness = createHarness();
      await expect(
        suspendOperatorWithDependencies(
          { operatorUserId: targetOperatorId, reason: ` ${reason} ` },
          harness.dependencies,
        ),
      ).resolves.toMatchObject({ operation: "suspend" });
    },
  );

  it("ignores client-supplied actor and role fields", async () => {
    const harness = createHarness();
    const untrusted = {
      operatorUserId: targetOperatorId,
      reason: "Policy violation",
      actorId: 999,
      role: "platform_owner",
    };

    await suspendOperatorWithDependencies(untrusted, harness.dependencies);
    expect(harness.successAudits()[0]?.operatorId).toBe(actorOperatorId);
  });
});

describe("suspension state conflicts and audit", () => {
  it("audits duplicate suspend as a conflict", async () => {
    const harness = createHarness({
      outcomes: [{ kind: "already_suspended", targetIsOwner: false }],
    });
    await expect(
      suspendOperatorWithDependencies(
        { operatorUserId: targetOperatorId, reason: "Policy violation" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "OPERATOR_ALREADY_SUSPENDED" });
    expect(harness.failureAudits()).toHaveLength(1);
  });

  it.each(["suspend", "unlock"] as const)(
    "rejects inactive target for %s",
    async (operation) => {
      const harness = createHarness({
        outcomes: [{ kind: "operator_inactive", targetIsOwner: false }],
      });
      await expect(execute(operation, targetOperatorId, harness)).rejects.toMatchObject(
        { code: "TARGET_OPERATOR_INACTIVE" },
      );
      expect(harness.failureAudits()).toHaveLength(1);
    },
  );

  it.each(["suspend", "unlock"] as const)(
    "does not audit a missing target for %s",
    async (operation) => {
      const harness = createHarness({ outcomes: [{ kind: "operator_not_found" }] });
      await expect(execute(operation, targetOperatorId, harness)).rejects.toMatchObject(
        { code: "OPERATOR_NOT_FOUND" },
      );
      expect(harness.allAudits()).toHaveLength(0);
    },
  );

  it("maps duplicate unlock and never copies the old suspension reason", async () => {
    const harness = createHarness({
      outcomes: [{ kind: "not_suspended", targetIsOwner: false }],
    });
    await expect(
      unlockOperatorWithDependencies(
        { operatorUserId: targetOperatorId },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "OPERATOR_NOT_SUSPENDED" });
    expect(harness.failureAudits()[0]?.payload).not.toHaveProperty(
      "suspensionReason",
    );
  });

  it("commits unlock with an audit that has no historical reason", async () => {
    const harness = createHarness({
      outcomes: [success("unlock", false)],
    });
    const result = await unlockOperatorWithDependencies(
      { operatorUserId: targetOperatorId },
      harness.dependencies,
    );
    expect(result.operator.suspendedAt).toBeNull();
    expect(harness.successAudits()[0]?.payload).not.toHaveProperty("reason");
  });
});

describe("transaction recheck, guard and retry", () => {
  it("checks actor access before and after a successful mutation", async () => {
    const harness = createHarness({
      transactionActorAccess: [ownerAccess(), ownerAccess()],
    });
    await suspendOperatorWithDependencies(
      { operatorUserId: targetOperatorId, reason: "Policy violation" },
      harness.dependencies,
    );
    expect(harness.transactionActorChecks()).toBe(2);
  });

  it.each([null, { role: "support" } as const])(
    "rolls back when actor loses access: %s",
    async (lostAccess) => {
      const harness = createHarness({
        transactionActorAccess: [ownerAccess(), lostAccess],
        externalActorAccess: lostAccess,
      });
      await expect(
        suspendOperatorWithDependencies(
          { operatorUserId: targetOperatorId, reason: "Policy violation" },
          harness.dependencies,
        ),
      ).rejects.toMatchObject({ code: "PLATFORM_ACCESS_DENIED" });
      expect(harness.committedMutationCount()).toBe(0);
      expect(harness.failureAudits()).toHaveLength(0);
    },
  );

  it("fails closed when post-rollback actor recheck fails technically", async () => {
    const harness = createHarness({
      transactionErrors: [new Error("database unavailable")],
      actorRecheckError: true,
    });
    await expect(
      suspendOperatorWithDependencies(
        { operatorUserId: targetOperatorId, reason: "Policy violation" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "OPERATOR_SUSPENSION_MUTATION_FAILED" });
    expect(harness.failureAudits()).toHaveLength(0);
  });

  it("maps only the exact last-owner constraint and audits after rollback", async () => {
    const harness = createHarness({
      targetIsOwner: true,
      transactionErrors: [postgresError("23514", "eligible_platform_owner_required")],
    });
    await expect(
      suspendOperatorWithDependencies(
        { operatorUserId: targetOperatorId, reason: "Policy violation" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "LAST_ELIGIBLE_PLATFORM_OWNER" });
    expect(harness.failureAudits()).toHaveLength(1);
  });

  it("does not mis-map another 23514 constraint", async () => {
    const harness = createHarness({
      transactionErrors: [postgresError("23514", "another_constraint")],
    });
    await expect(
      suspendOperatorWithDependencies(
        { operatorUserId: targetOperatorId, reason: "Policy violation" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "OPERATOR_SUSPENSION_MUTATION_FAILED" });
  });

  it.each(["40001", "40P01"])(
    "retries the whole transaction for %s and leaves one success audit",
    async (code) => {
      const harness = createHarness({
        transactionErrors: [postgresError(code), null],
        retryDelays: [23],
      });
      await suspendOperatorWithDependencies(
        { operatorUserId: targetOperatorId, reason: "Policy violation" },
        harness.dependencies,
      );
      expect(harness.runTransaction).toHaveBeenCalledTimes(2);
      expect(harness.waitBeforeRetry).toHaveBeenCalledWith(23);
      expect(harness.successAudits()).toHaveLength(1);
    },
  );

  it("stops after three retries and bounds backoff to 0..100ms", async () => {
    const harness = createHarness({
      transactionErrors: [
        postgresError("40001"),
        postgresError("40001"),
        postgresError("40001"),
      ],
      retryDelays: [-5, 1000],
    });
    await expect(
      suspendOperatorWithDependencies(
        { operatorUserId: targetOperatorId, reason: "Policy violation" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "OPERATOR_SUSPENSION_RETRY_EXHAUSTED" });
    expect(harness.runTransaction).toHaveBeenCalledTimes(3);
    expect(harness.waitBeforeRetry.mock.calls).toEqual([[0], [100]]);
  });

  it("rolls back when success audit fails", async () => {
    const harness = createHarness({ successAuditFailure: true });
    await expect(
      suspendOperatorWithDependencies(
        { operatorUserId: targetOperatorId, reason: "Policy violation" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_AUDIT_FAILED" });
    expect(harness.committedMutationCount()).toBe(0);
  });

  it("fails closed when required failure audit fails", async () => {
    const harness = createHarness({
      outcomes: [{ kind: "already_suspended", targetIsOwner: false }],
      failureAuditFailure: true,
    });
    await expect(
      suspendOperatorWithDependencies(
        { operatorUserId: targetOperatorId, reason: "Policy violation" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_AUDIT_FAILED" });
  });
});

type HarnessOptions = {
  actorRole?: PlatformRole;
  targetOperatorId?: number;
  targetIsOwner?: boolean;
  outcomes?: PlatformSuspensionStoreOutcome[];
  transactionActorAccess?: Array<PlatformSuspensionActorAccess | null>;
  externalActorAccess?: PlatformSuspensionActorAccess | null;
  transactionErrors?: Array<Error | null>;
  retryDelays?: number[];
  actorRecheckError?: boolean;
  successAuditFailure?: boolean;
  failureAuditFailure?: boolean;
};

function createHarness(options: HarnessOptions = {}) {
  const actorRole = options.actorRole ?? "platform_owner";
  const targetId = options.targetOperatorId ?? targetOperatorId;
  const targetIsOwner = options.targetIsOwner ?? false;
  const outcomes = [...(options.outcomes ?? [])];
  const transactionActorAccess = [...(options.transactionActorAccess ?? [])];
  const transactionErrors = [...(options.transactionErrors ?? [])];
  const retryDelays = [...(options.retryDelays ?? [])];
  const committed = { mutationCount: 0, audits: [] as PlatformAuditRecord[] };
  const failureAudits: PlatformAuditRecord[] = [];
  const events: string[] = [];
  let transactionActorChecks = 0;

  const authorizeActor = vi.fn(async () => {
    if (actorRole === "support") throw accessDenied();
    return { operatorId: actorOperatorId };
  });
  const runTransaction = vi.fn();
  const runTransactionWithStore: PlatformSuspensionDependencies["runTransaction"] =
    async <T>(
      callback: (store: PlatformSuspensionTransactionStore) => Promise<T>,
    ) => {
      runTransaction();
      events.push("transaction:start");
      const local = {
        mutationCount: committed.mutationCount,
        audits: [...committed.audits],
      };
      const nextOutcome = (operation: "suspend" | "unlock") => {
        const outcome =
          outcomes.shift() ?? success(operation, targetIsOwner, targetId);
        if (outcome.kind === "success") local.mutationCount += 1;
        return Promise.resolve(outcome);
      };
      const store: PlatformSuspensionTransactionStore = {
        findActorAccess: async () => {
          transactionActorChecks += 1;
          return transactionActorAccess.length > 0
            ? (transactionActorAccess.shift() ?? null)
            : { role: actorRole };
        },
        findTargetContext: async () => ({ isOwner: targetIsOwner }),
        suspend: async () => nextOutcome("suspend"),
        unlock: async () => nextOutcome("unlock"),
        insertAuditRecord: async (record) => {
          if (options.successAuditFailure) throw new Error("audit unavailable");
          local.audits.push(record);
        },
      };

      try {
        const result = await callback(store);
        const transactionError = transactionErrors.shift();
        if (transactionError) throw transactionError;
        committed.mutationCount = local.mutationCount;
        committed.audits = local.audits;
        events.push("transaction:commit");
        return result;
      } catch (error) {
        events.push("transaction:rollback");
        throw error;
      }
    };
  const findActorAccess = vi.fn(async () => {
    if (options.actorRecheckError) throw new Error("recheck unavailable");
    return options.externalActorAccess === undefined
      ? { role: actorRole }
      : options.externalActorAccess;
  });
  const findTargetContext = vi.fn(async () => ({ isOwner: targetIsOwner }));
  const insertFailureAuditRecord = vi.fn(async (record: PlatformAuditRecord) => {
    if (options.failureAuditFailure) throw new Error("audit unavailable");
    events.push("audit:failure");
    failureAudits.push(record);
  });
  const waitBeforeRetry = vi.fn(async () => undefined);

  const dependencies: PlatformSuspensionDependencies = {
    authorizeActor,
    runTransaction: runTransactionWithStore,
    findActorAccess,
    findTargetContext,
    insertFailureAuditRecord,
    waitBeforeRetry,
    retryDelayMilliseconds: () => retryDelays.shift() ?? 0,
  };

  return {
    dependencies,
    authorizeActor,
    runTransaction,
    waitBeforeRetry,
    events,
    transactionActorChecks: () => transactionActorChecks,
    committedMutationCount: () => committed.mutationCount,
    successAudits: () => committed.audits,
    failureAudits: () => failureAudits,
    allAudits: () => [...committed.audits, ...failureAudits],
  };
}

function success(
  operation: "suspend" | "unlock",
  targetIsOwner: boolean,
  operatorUserId = targetOperatorId,
): PlatformSuspensionStoreOutcome {
  return {
    kind: "success",
    targetIsOwner,
    result: {
      operation,
      operator: {
        id: operatorUserId,
        suspendedAt: operation === "suspend" ? suspendedAt : null,
      },
    },
  };
}

function ownerAccess(): PlatformSuspensionActorAccess {
  return { role: "platform_owner" };
}

function execute(
  operation: "suspend" | "unlock",
  operatorUserId: number,
  harness: ReturnType<typeof createHarness>,
) {
  return operation === "suspend"
    ? suspendOperatorWithDependencies(
        { operatorUserId, reason: "Policy violation" },
        harness.dependencies,
      )
    : unlockOperatorWithDependencies({ operatorUserId }, harness.dependencies);
}

function postgresError(code: string, constraint_name?: string) {
  return Object.assign(new Error("isolated database failure"), {
    code,
    constraint_name,
  });
}

function accessDenied() {
  return new OperatorApiError(
    403,
    "PLATFORM_ACCESS_DENIED",
    "Platform access is not permitted.",
  );
}
