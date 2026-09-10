import { describe, expect, it, vi } from "vitest";

import {
  resolveOperatorAccess,
  resolveSignInPageAccess,
  type LinkedOperatorRecord,
} from "@/server/operator-api/auth-policy";
import { OperatorApiError } from "@/server/operator-api/errors";
import { authorizePlatformAdminSession } from "@/server/platform-admin/guard-core";

const activeOperator: LinkedOperatorRecord = {
  id: 7,
  name: "Operator",
  displayName: null,
  profileCompletedAt: null,
  active: true,
  suspendedAt: null,
};

describe("operator suspension authorization", () => {
  it("allows an existing active operator with an unsuspended state", () => {
    const decision = resolveOperatorAccess("auth-user", activeOperator);

    expect(decision).toEqual({
      allowed: true,
      operator: {
        id: 7,
        name: "Operator",
        displayName: null,
        profileCompletedAt: null,
        active: true,
      },
    });
    expect(decision.allowed && "suspendedAt" in decision.operator).toBe(false);
  });

  it("denies an active suspended operator without exposing suspension details", () => {
    const operatorWithInternalReason: LinkedOperatorRecord & {
      suspensionReason: string;
    } = {
      ...activeOperator,
      suspendedAt: new Date("2026-07-15T10:00:00.000Z"),
      suspensionReason: "Sensitive internal reason",
    };
    const decision = resolveOperatorAccess(
      "auth-user",
      operatorWithInternalReason,
    );

    expect(decision).toEqual({
      allowed: false,
      status: 403,
      code: "OPERATOR_SUSPENDED",
      message: "Application access is suspended.",
    });
    expect(JSON.stringify(decision)).not.toContain("Sensitive internal reason");
    expect(
      resolveSignInPageAccess("auth-user", {
        ...activeOperator,
        suspendedAt: new Date("2026-07-15T10:00:00.000Z"),
      }),
    ).toEqual({ state: "unauthorized", code: "OPERATOR_SUSPENDED" });
  });

  it("preserves the existing inactive denial before suspension", () => {
    expect(
      resolveOperatorAccess("auth-user", {
        ...activeOperator,
        active: false,
        suspendedAt: new Date("2026-07-15T10:00:00.000Z"),
      }),
    ).toEqual({
      allowed: false,
      status: 403,
      code: "OPERATOR_INACTIVE",
      message: "This operator account is inactive.",
    });
  });

  it("does not let workspace membership bypass suspension", () => {
    const operatorWithWorkspaceMembership = {
      ...activeOperator,
      suspendedAt: new Date("2026-07-15T10:00:00.000Z"),
      workspaceMembership: { active: true, role: "owner" },
    };

    expect(
      resolveOperatorAccess("auth-user", operatorWithWorkspaceMembership),
    ).toMatchObject({
      allowed: false,
      status: 403,
      code: "OPERATOR_SUSPENDED",
    });
  });

  it("rejects suspension before looking up an active platform membership", async () => {
    const findActivePlatformMembership = vi.fn();

    await expect(
      authorizePlatformAdminSession("admin.access", {
        requireOperatorSession: async () => {
          throw new OperatorApiError(
            403,
            "OPERATOR_SUSPENDED",
            "Application access is suspended.",
          );
        },
        findActivePlatformMembership,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "OPERATOR_SUSPENDED",
      message: "Application access is suspended.",
    });
    expect(findActivePlatformMembership).not.toHaveBeenCalled();
  });
});
