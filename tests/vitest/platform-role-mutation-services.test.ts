import { describe, expect, it, vi } from "vitest";

import { OperatorApiError } from "@/server/operator-api/errors";
import type { PlatformAuditRecord } from "@/server/platform-admin/audit-core";
import {
  changePlatformMembershipRoleWithDependencies,
  deactivatePlatformMembershipWithDependencies,
  grantOrReactivatePlatformMembershipWithDependencies,
  removePlatformMembershipWithDependencies,
  type PlatformRoleMutationDependencies,
  type PlatformRoleMutationResult,
  type PlatformRoleMutationStoreOutcome,
  type PlatformRoleMutationTransactionStore,
} from "@/server/platform-admin/role-mutation-core";

const actorOperatorId = 7;
const targetOperatorId = 42;
const targetMembershipId = 99;

describe("platform role mutation RBAC boundary", () => {
  it("allows an eligible owner to enter the service", async () => {
    const harness = createHarness({ outcomes: [success("grant", "support")] });

    await expect(
      grantOrReactivatePlatformMembershipWithDependencies(
        { operatorUserId: targetOperatorId, role: "support" },
        harness.dependencies,
      ),
    ).resolves.toMatchObject({ operation: "grant" });
    expect(harness.authorizeActor).toHaveBeenCalledOnce();
    expect(harness.runTransaction).toHaveBeenCalledOnce();
  });

  it.each([
    ["platform_admin", "PLATFORM_ACCESS_DENIED"],
    ["support", "PLATFORM_ACCESS_DENIED"],
    ["operator without membership", "PLATFORM_ACCESS_DENIED"],
    ["suspended owner", "OPERATOR_SUSPENDED"],
    ["inactive owner", "OPERATOR_INACTIVE"],
  ])("rejects %s before reading the target", async (_label, code) => {
    const harness = createHarness({
      authorizationError: new OperatorApiError(
        403,
        code,
        "Platform access is not permitted.",
      ),
    });

    await expect(
      grantOrReactivatePlatformMembershipWithDependencies(
        { operatorUserId: targetOperatorId, role: "support" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code });
    expect(harness.runTransaction).not.toHaveBeenCalled();
    expect(harness.targetMutationCalls()).toBe(0);
  });
});

describe("grant and reactivate platform membership", () => {
  it("creates a missing membership", async () => {
    const harness = createHarness({
      outcomes: [success("grant", "support")],
    });

    const result = await grantOrReactivatePlatformMembershipWithDependencies(
      { operatorUserId: targetOperatorId, role: "support" },
      harness.dependencies,
    );

    expect(result).toEqual(resultFor("grant", "support", true));
    expect(harness.successAudits()).toHaveLength(1);
    expect(harness.successAudits()[0]).toMatchObject({
      action: "platform_role.grant",
      entityId: String(targetMembershipId),
      payload: { outcome: "success" },
    });
  });

  it("reactivates an inactive membership with the selected role", async () => {
    const harness = createHarness({
      outcomes: [success("reactivate", "platform_admin")],
    });

    await expect(
      grantOrReactivatePlatformMembershipWithDependencies(
        { operatorUserId: targetOperatorId, role: "platform_admin" },
        harness.dependencies,
      ),
    ).resolves.toEqual(resultFor("reactivate", "platform_admin", true));
  });

  it.each([
    [
      { kind: "membership_active", membershipId: targetMembershipId } as const,
      "PLATFORM_MEMBERSHIP_ACTIVE",
    ],
    [{ kind: "operator_inactive" } as const, "TARGET_OPERATOR_INACTIVE"],
  ])("audits and rejects %s", async (outcome, code) => {
    const harness = createHarness({ outcomes: [outcome] });

    await expect(
      grantOrReactivatePlatformMembershipWithDependencies(
        { operatorUserId: targetOperatorId, role: "support" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code });
    expect(harness.failureAudits()).toHaveLength(1);
  });

  it("does not audit a missing operator target", async () => {
    const harness = createHarness({ outcomes: [{ kind: "operator_not_found" }] });

    await expect(
      grantOrReactivatePlatformMembershipWithDependencies(
        { operatorUserId: targetOperatorId, role: "support" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "OPERATOR_NOT_FOUND" });
    expect(harness.allAudits()).toHaveLength(0);
  });
});

describe("change, deactivate and remove platform membership", () => {
  it.each([
    ["change", success("change", "platform_admin")],
    ["deactivate", success("deactivate", "support", false)],
    ["remove", success("remove", "support", false)],
  ] as const)("completes an atomic %s operation", async (operation, outcome) => {
    const harness = createHarness({ outcomes: [outcome] });

    const result = await executeMembershipOperation(operation, harness);

    expect(result.operation).toBe(operation);
    expect(harness.committedMutationCount()).toBe(1);
    expect(harness.successAudits()).toHaveLength(1);
  });

  it("rejects a no-op role change", async () => {
    const harness = createHarness({
      outcomes: [{ kind: "role_no_op", membershipId: targetMembershipId }],
    });

    await expect(
      changePlatformMembershipRoleWithDependencies(
        {
          membershipId: targetMembershipId,
          expectedRole: "support",
          role: "support",
        },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_ROLE_NO_OP" });
    expect(harness.failureAudits()).toHaveLength(1);
  });

  it.each(["change", "deactivate", "remove"] as const)(
    "rejects owner self-%s and audits after rollback",
    async (operation) => {
      const harness = createHarness({
        outcomes: [
          { kind: "self_mutation", membershipId: targetMembershipId },
        ],
      });

      await expect(executeMembershipOperation(operation, harness)).rejects.toMatchObject(
        { code: "PLATFORM_ROLE_SELF_MUTATION" },
      );
      expect(harness.events).toEqual([
        "transaction:start",
        "transaction:rollback",
        "audit:failure",
      ]);
      expect(harness.committedMutationCount()).toBe(0);
    },
  );

  it.each([
    { kind: "membership_inactive", membershipId: targetMembershipId },
    { kind: "role_mismatch", membershipId: targetMembershipId },
  ] as const)("rejects an invalid current membership state", async (outcome) => {
    const harness = createHarness({ outcomes: [outcome] });

    await expect(
      changePlatformMembershipRoleWithDependencies(
        {
          membershipId: targetMembershipId,
          expectedRole: "support",
          role: "platform_admin",
        },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_MEMBERSHIP_INVALID_STATE" });
    expect(harness.failureAudits()).toHaveLength(1);
  });

  it("does not audit a missing membership", async () => {
    const harness = createHarness({
      outcomes: [{ kind: "membership_not_found" }],
    });

    await expect(
      deactivatePlatformMembershipWithDependencies(
        { membershipId: targetMembershipId },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_MEMBERSHIP_NOT_FOUND" });
    expect(harness.allAudits()).toHaveLength(0);
  });
});

describe("database guard, transaction audit and retry", () => {
  it("maps only the exact last-owner guard and writes failure audit after rollback", async () => {
    const harness = createHarness({
      transactionErrors: [
        new Error("Drizzle query failed", {
          cause: postgresError(
            "23514",
            "eligible_platform_owner_required",
          ),
        }),
      ],
    });

    await expect(
      deactivatePlatformMembershipWithDependencies(
        { membershipId: targetMembershipId },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "LAST_ELIGIBLE_PLATFORM_OWNER" });
    expect(harness.events).toEqual([
      "transaction:start",
      "transaction:rollback",
      "audit:failure",
    ]);
    expect(harness.isActorEligible).toHaveBeenCalledOnce();
  });

  it("hides a target guard error when the actor lost eligibility after rollback", async () => {
    const harness = createHarness({
      actorEligibleAfterRollback: false,
      transactionErrors: [
        postgresError("23514", "eligible_platform_owner_required"),
      ],
    });

    await expect(
      deactivatePlatformMembershipWithDependencies(
        { membershipId: targetMembershipId },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_ACCESS_DENIED" });
    expect(harness.failureAudits()).toHaveLength(0);
    expect(harness.committedMutationCount()).toBe(0);
  });

  it("fails closed when post-rollback actor eligibility cannot be checked", async () => {
    const harness = createHarness({
      actorEligibilityCheckError: new Error("eligibility unavailable"),
      transactionErrors: [
        postgresError("23514", "eligible_platform_owner_required"),
      ],
    });

    await expect(
      deactivatePlatformMembershipWithDependencies(
        { membershipId: targetMembershipId },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({
      status: 503,
      code: "PLATFORM_ROLE_MUTATION_FAILED",
    });
    expect(harness.failureAudits()).toHaveLength(0);
  });

  it("does not mis-map another 23514 constraint", async () => {
    const harness = createHarness({
      transactionErrors: [postgresError("23514", "unrelated_check")],
    });

    await expect(
      deactivatePlatformMembershipWithDependencies(
        { membershipId: targetMembershipId },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_ROLE_MUTATION_FAILED" });
    expect(harness.failureAudits()).toHaveLength(0);
  });

  it("rolls back the mutation when success audit insertion fails", async () => {
    const harness = createHarness({ successAuditFailure: true });

    await expect(
      deactivatePlatformMembershipWithDependencies(
        { membershipId: targetMembershipId },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_AUDIT_FAILED" });
    expect(harness.committedMutationCount()).toBe(0);
    expect(harness.successAudits()).toHaveLength(0);
  });

  it("returns a safe audit error when required failure audit fails", async () => {
    const harness = createHarness({
      outcomes: [{ kind: "self_mutation", membershipId: targetMembershipId }],
      failureAuditFailure: true,
    });

    await expect(
      removePlatformMembershipWithDependencies(
        { membershipId: targetMembershipId },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_AUDIT_FAILED" });
  });

  it.each(["40001", "40P01"])(
    "retries the whole transaction for %s and persists one final audit",
    async (code) => {
      const harness = createHarness({
        transactionErrors: [postgresError(code), null],
        retryDelays: [23],
      });

      await expect(
        deactivatePlatformMembershipWithDependencies(
          { membershipId: targetMembershipId },
          harness.dependencies,
        ),
      ).resolves.toMatchObject({ operation: "deactivate" });
      expect(harness.runTransaction).toHaveBeenCalledTimes(2);
      expect(harness.waitBeforeRetry).toHaveBeenCalledWith(23);
      expect(harness.committedMutationCount()).toBe(1);
      expect(harness.successAudits()).toHaveLength(1);
      expect(harness.failureAudits()).toHaveLength(0);
    },
  );

  it("stops after three full retry attempts", async () => {
    const harness = createHarness({
      transactionErrors: [
        postgresError("40001"),
        postgresError("40P01"),
        postgresError("40001"),
      ],
    });

    await expect(
      deactivatePlatformMembershipWithDependencies(
        { membershipId: targetMembershipId },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_ROLE_RETRY_EXHAUSTED" });
    expect(harness.runTransaction).toHaveBeenCalledTimes(3);
    expect(harness.waitBeforeRetry).toHaveBeenCalledTimes(2);
    expect(harness.allAudits()).toHaveLength(0);
    expect(harness.committedMutationCount()).toBe(0);
  });

  it.each([
    ["negative", -25, 0],
    ["NaN", Number.NaN, 0],
    ["infinite", Number.POSITIVE_INFINITY, 0],
    ["over maximum", 250, 100],
  ])("bounds an injected %s retry delay", async (_label, delay, expected) => {
    const harness = createHarness({
      transactionErrors: [postgresError("40001"), null],
      retryDelays: [delay],
    });

    await deactivatePlatformMembershipWithDependencies(
      { membershipId: targetMembershipId },
      harness.dependencies,
    );

    expect(harness.waitBeforeRetry).toHaveBeenCalledWith(expected);
  });

  it("does not retry non-transient database errors", async () => {
    const harness = createHarness({
      transactionErrors: [postgresError("23505", "platform_members_operator_idx")],
    });

    await expect(
      deactivatePlatformMembershipWithDependencies(
        { membershipId: targetMembershipId },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_ROLE_MUTATION_FAILED" });
    expect(harness.runTransaction).toHaveBeenCalledOnce();
    expect(harness.waitBeforeRetry).not.toHaveBeenCalled();
  });

  it("rejects before reading the target when actor eligibility is stale", async () => {
    const harness = createHarness({
      actorEligibilityInTransaction: [false],
      actorEligibleAfterRollback: false,
    });

    await expect(
      deactivatePlatformMembershipWithDependencies(
        { membershipId: targetMembershipId },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_ACCESS_DENIED" });
    expect(harness.committedMutationCount()).toBe(0);
    expect(harness.allAudits()).toHaveLength(0);
    expect(harness.targetMutationCalls()).toBe(0);
    expect(harness.transactionEligibilityChecks()).toBe(1);
  });

  it("checks actor eligibility before and after a successful mutation", async () => {
    const harness = createHarness({
      actorEligibilityInTransaction: [true, true],
    });

    await deactivatePlatformMembershipWithDependencies(
      { membershipId: targetMembershipId },
      harness.dependencies,
    );

    expect(harness.targetMutationCalls()).toBe(1);
    expect(harness.transactionEligibilityChecks()).toBe(2);
    expect(harness.isActorEligible).not.toHaveBeenCalled();
  });

  it("rejects invalid input without authorization, transaction or audit", async () => {
    const harness = createHarness();

    await expect(
      removePlatformMembershipWithDependencies(
        { membershipId: 0 },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "INVALID_PLATFORM_ROLE_MUTATION_INPUT" });
    expect(harness.authorizeActor).not.toHaveBeenCalled();
    expect(harness.runTransaction).not.toHaveBeenCalled();
    expect(harness.allAudits()).toHaveLength(0);
  });
});

type HarnessOptions = {
  authorizationError?: OperatorApiError;
  outcomes?: PlatformRoleMutationStoreOutcome[];
  actorEligibilityInTransaction?: boolean[];
  actorEligibleAfterRollback?: boolean;
  actorEligibilityCheckError?: Error;
  transactionErrors?: Array<Error | null>;
  successAuditFailure?: boolean;
  failureAuditFailure?: boolean;
  retryDelays?: number[];
};

function createHarness(options: HarnessOptions = {}) {
  const outcomes = [...(options.outcomes ?? [])];
  const transactionErrors = [...(options.transactionErrors ?? [])];
  const retryDelays = [...(options.retryDelays ?? [])];
  const actorEligibilityInTransaction = [
    ...(options.actorEligibilityInTransaction ?? []),
  ];
  const committed = { mutationCount: 0, audits: [] as PlatformAuditRecord[] };
  const failureAudits: PlatformAuditRecord[] = [];
  const events: string[] = [];
  let targetMutationCalls = 0;
  let transactionEligibilityChecks = 0;

  const authorizeActor = vi.fn(async () => {
    if (options.authorizationError) throw options.authorizationError;
    return { operatorId: actorOperatorId };
  });
  const runTransaction = vi.fn();
  const runTransactionWithStore: PlatformRoleMutationDependencies["runTransaction"] =
    async <T>(
      callback: (store: PlatformRoleMutationTransactionStore) => Promise<T>,
    ) => {
      runTransaction();
      events.push("transaction:start");
      const local = {
        mutationCount: committed.mutationCount,
        audits: [...committed.audits],
      };
      const nextOutcome = () => {
        targetMutationCalls += 1;
        const outcome = outcomes.shift() ?? success("deactivate", "support", false);
        if (outcome.kind === "success") local.mutationCount += 1;
        return Promise.resolve(outcome);
      };
      const store: PlatformRoleMutationTransactionStore = {
        grantOrReactivate: nextOutcome,
        changeRole: nextOutcome,
        deactivate: nextOutcome,
        remove: nextOutcome,
        isEligiblePlatformOwner: async () => {
          transactionEligibilityChecks += 1;
          return actorEligibilityInTransaction.shift() ?? true;
        },
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
  const insertFailureAuditRecord = vi.fn(async (record: PlatformAuditRecord) => {
    if (options.failureAuditFailure) throw new Error("audit unavailable");
    events.push("audit:failure");
    failureAudits.push(record);
  });
  const waitBeforeRetry = vi.fn(async () => undefined);
  const isActorEligible = vi.fn(async () => {
    if (options.actorEligibilityCheckError) {
      throw options.actorEligibilityCheckError;
    }
    return options.actorEligibleAfterRollback ?? true;
  });
  const dependencies: PlatformRoleMutationDependencies = {
    authorizeActor,
    runTransaction: runTransactionWithStore,
    isActorEligible,
    insertFailureAuditRecord,
    waitBeforeRetry,
    retryDelayMilliseconds: () => retryDelays.shift() ?? 0,
  };

  return {
    dependencies,
    authorizeActor,
    runTransaction,
    isActorEligible,
    waitBeforeRetry,
    events,
    targetMutationCalls: () => targetMutationCalls,
    transactionEligibilityChecks: () => transactionEligibilityChecks,
    committedMutationCount: () => committed.mutationCount,
    successAudits: () => committed.audits,
    failureAudits: () => failureAudits,
    allAudits: () => [...committed.audits, ...failureAudits],
  };
}

function success(
  operation: PlatformRoleMutationResult["operation"],
  role: PlatformRoleMutationResult["membership"]["role"],
  active = true,
): PlatformRoleMutationStoreOutcome {
  return { kind: "success", result: resultFor(operation, role, active) };
}

function resultFor(
  operation: PlatformRoleMutationResult["operation"],
  role: PlatformRoleMutationResult["membership"]["role"],
  active: boolean,
): PlatformRoleMutationResult {
  return {
    operation,
    membership: {
      id: targetMembershipId,
      operatorUserId: targetOperatorId,
      role,
      active,
    },
  };
}

function executeMembershipOperation(
  operation: "change" | "deactivate" | "remove",
  harness: ReturnType<typeof createHarness>,
) {
  switch (operation) {
    case "change":
      return changePlatformMembershipRoleWithDependencies(
        {
          membershipId: targetMembershipId,
          expectedRole: "support",
          role: "platform_admin",
        },
        harness.dependencies,
      );
    case "deactivate":
      return deactivatePlatformMembershipWithDependencies(
        { membershipId: targetMembershipId },
        harness.dependencies,
      );
    case "remove":
      return removePlatformMembershipWithDependencies(
        { membershipId: targetMembershipId },
        harness.dependencies,
      );
  }
}

function postgresError(code: string, constraintName?: string) {
  return Object.assign(new Error("database failure"), {
    code,
    ...(constraintName ? { constraint_name: constraintName } : {}),
  });
}
