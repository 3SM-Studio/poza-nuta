import { describe, expect, it, vi } from "vitest";

import { OperatorApiError } from "@/server/operator-api/errors";
import {
  createAdminActorViewModel,
  resolvePlatformAdminPageAccess,
} from "@/server/platform-admin/page-access-core";

describe("platform admin page access", () => {
  it("maps unauthenticated sessions to the sign-in decision", async () => {
    await expect(
      resolvePlatformAdminPageAccess(async () => {
        throw new OperatorApiError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication required.",
        );
      }),
    ).resolves.toEqual({ kind: "unauthenticated" });
  });

  it.each([
    "PLATFORM_ACCESS_DENIED",
    "OPERATOR_INACTIVE",
    "OPERATOR_SUSPENDED",
    "OPERATOR_NOT_LINKED",
  ])("maps safe 403 %s to a neutral denial", async (code) => {
    await expect(
      resolvePlatformAdminPageAccess(async () => {
        throw new OperatorApiError(403, code, "Safe denial.");
      }),
    ).resolves.toEqual({ kind: "denied" });
  });

  it("does not turn infrastructure failures into access denial", async () => {
    const infrastructureError = new OperatorApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Infrastructure unavailable.",
    );

    await expect(
      resolvePlatformAdminPageAccess(async () => {
        throw infrastructureError;
      }),
    ).rejects.toBe(infrastructureError);
  });

  it("returns a browser-safe actor model without ids or email", () => {
    const actor = createAdminActorViewModel({
      operator: {
        name: "operator-login",
        displayName: "  Anna Kowalska  ",
      },
      platformMembership: {
        role: "platform_admin",
      },
    });

    expect(actor).toEqual({
      displayName: "Anna Kowalska",
      initials: "AK",
      role: "platform_admin",
    });
    expect(Object.keys(actor).sort()).toEqual([
      "displayName",
      "initials",
      "role",
    ]);
  });

  it("resolves every platform role through the same server-side access dependency", async () => {
    for (const role of [
      "platform_owner",
      "platform_admin",
      "support",
    ] as const) {
      const requireAccess = vi.fn(async () => session(role));
      const access = await resolvePlatformAdminPageAccess(requireAccess);

      expect(access).toMatchObject({ kind: "allowed", actor: { role } });
      expect(requireAccess).toHaveBeenCalledOnce();
    }
  });
});

function session(
  role: "platform_owner" | "platform_admin" | "support",
) {
  return {
    operator: {
      name: "Operator",
      displayName: null,
    },
    platformMembership: { role },
  };
}
