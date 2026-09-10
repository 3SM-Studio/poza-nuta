import { describe, expect, it, vi } from "vitest";

import { OperatorApiError } from "@/server/operator-api/errors";
import { operatorApiErrorResponse } from "@/server/operator-api/responses";
import {
  authorizePlatformAdminSession,
  type ActivePlatformMembership,
} from "@/server/platform-admin/guard-core";
import {
  getPlatformPermissionDecision,
  hasPlatformPermission,
  platformPermissions,
  type PlatformPermission,
  type PlatformPermissionDecision,
  type PlatformRole,
} from "@/server/platform-admin/policy";

const expectedAllowedPermissions = {
  platform_owner: [
    "admin.access",
    "catalog_import_history.read",
    "imports.ising.start",
    "imports.karafun.execute",
    "imports.cancel",
    "users.read",
    "users.suspend_non_owner",
    "platform_members.mutate_non_owner",
    "platform_members.grant_owner",
    "organizations.read",
    "audit.read",
  ],
  platform_admin: [
    "admin.access",
    "catalog_import_history.read",
    "imports.ising.start",
    "imports.karafun.execute",
    "imports.cancel",
    "users.read",
    "users.suspend_non_owner",
    "organizations.read",
    "audit.read",
  ],
  support: [
    "admin.access",
    "catalog_import_history.read",
    "users.read",
    "organizations.read",
    "audit.read",
  ],
} as const satisfies Record<PlatformRole, readonly PlatformPermission[]>;

const exceptionalDecisions = {
  platform_owner: {
    "users.suspend_owner": "conditional",
    "platform_members.mutate_owner": "conditional",
    "system.critical_settings": "deferred",
  },
  platform_admin: {},
  support: {},
} as const satisfies Record<
  PlatformRole,
  Partial<Record<PlatformPermission, PlatformPermissionDecision>>
>;

describe("platform admin permission policy", () => {
  for (const role of Object.keys(expectedAllowedPermissions) as PlatformRole[]) {
    it(`matches every documented permission for ${role}`, () => {
      const allowed = new Set<PlatformPermission>(
        expectedAllowedPermissions[role],
      );

      for (const permission of platformPermissions) {
        const expected = allowed.has(permission)
          ? "allow"
          : (exceptionalDecisions[role] as Partial<
              Record<PlatformPermission, PlatformPermissionDecision>
            >)[permission] ?? "deny";

        expect(getPlatformPermissionDecision(role, permission)).toBe(expected);
        expect(hasPlatformPermission(role, permission)).toBe(
          expected === "allow",
        );
      }
    });
  }

  it("reserves every platform membership mutation for the owner", () => {
    const mutations = [
      "platform_members.mutate_non_owner",
      "platform_members.grant_owner",
    ] as const;

    for (const permission of mutations) {
      expect(hasPlatformPermission("platform_owner", permission)).toBe(true);
      expect(hasPlatformPermission("platform_admin", permission)).toBe(false);
      expect(hasPlatformPermission("support", permission)).toBe(false);
    }

    expect(
      getPlatformPermissionDecision(
        "platform_owner",
        "platform_members.mutate_owner",
      ),
    ).toBe("conditional");
    expect(
      hasPlatformPermission(
        "platform_owner",
        "platform_members.mutate_owner",
      ),
    ).toBe(false);
  });
});

describe("platform admin guard", () => {
  it.each([
    ["platform_owner", "platform_members.mutate_non_owner"],
    ["platform_admin", "imports.ising.start"],
    ["support", "users.read"],
  ] as const)("allows %s to use %s", async (role, permission) => {
    const session = operatorSession();
    const result = await authorizePlatformAdminSession(permission, {
      requireOperatorSession: async () => session,
      findActivePlatformMembership: async () => membership(role),
    });

    expect(result.operator.id).toBe(session.operator.id);
    expect(result.platformMembership.role).toBe(role);
  });

  it.each([
    ["platform_admin", "platform_members.mutate_non_owner"],
    ["platform_admin", "users.suspend_owner"],
    ["support", "imports.cancel"],
    ["platform_owner", "audit.export"],
  ] as const)("denies %s access to %s", async (role, permission) => {
    await expect(
      authorizePlatformAdminSession(permission, {
        requireOperatorSession: async () => operatorSession(),
        findActivePlatformMembership: async () => membership(role),
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "PLATFORM_ACCESS_DENIED",
      message: "Platform access is not permitted.",
    });
  });

  it("denies an active operator without an active platform membership", async () => {
    const findActivePlatformMembership = vi.fn(async () => null);

    await expect(
      authorizePlatformAdminSession("admin.access", {
        requireOperatorSession: async () => ({
          ...operatorSession(),
          workspaceMembership: { role: "owner" },
        }),
        findActivePlatformMembership,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "PLATFORM_ACCESS_DENIED",
    });
    expect(findActivePlatformMembership).toHaveBeenCalledWith(7);
  });

  it("rejects a membership that does not belong to the resolved operator", async () => {
    await expect(
      authorizePlatformAdminSession("admin.access", {
        requireOperatorSession: async () => operatorSession(),
        findActivePlatformMembership: async () => ({
          ...membership("platform_owner"),
          operatorUserId: 99,
        }),
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "PLATFORM_ACCESS_DENIED",
    });
  });

  it.each([
    [401, "AUTHENTICATION_REQUIRED"],
    [403, "OPERATOR_NOT_LINKED"],
    [403, "OPERATOR_INACTIVE"],
  ] as const)(
    "preserves the safe session error %s %s",
    async (status, code) => {
      const findActivePlatformMembership = vi.fn();

      await expect(
        authorizePlatformAdminSession("admin.access", {
          requireOperatorSession: async () => {
            throw new OperatorApiError(status, code, "Safe session error.");
          },
          findActivePlatformMembership,
        }),
      ).rejects.toMatchObject({ status, code });
      expect(findActivePlatformMembership).not.toHaveBeenCalled();
    },
  );

  it("maps authorization denial to a safe API response", async () => {
    let caught: unknown;

    try {
      await authorizePlatformAdminSession("imports.ising.start", {
        requireOperatorSession: async () => operatorSession(),
        findActivePlatformMembership: async () => membership("support"),
      });
    } catch (error) {
      caught = error;
    }

    const response = operatorApiErrorResponse(caught);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PLATFORM_ACCESS_DENIED",
        message: "Platform access is not permitted.",
      },
    });
  });
});

function operatorSession() {
  return {
    authUser: { id: "auth-user", email: "operator@example.test" },
    operator: {
      id: 7,
      name: "Operator",
      displayName: null,
      profileCompletedAt: new Date(),
      active: true as const,
    },
  };
}

function membership(role: PlatformRole): ActivePlatformMembership {
  return {
    id: 11,
    operatorUserId: 7,
    role,
    active: true,
  };
}
