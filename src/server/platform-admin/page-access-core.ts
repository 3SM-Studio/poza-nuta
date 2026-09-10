import { OperatorApiError } from "@/server/operator-api/errors";

import type { PlatformRole } from "./policy";

export type AdminActorViewModel = {
  displayName: string;
  initials: string;
  role: PlatformRole;
};

type PlatformAdminPageSession = {
  operator: {
    name: string;
    displayName: string | null;
  };
  platformMembership: {
    role: PlatformRole;
  };
};

export type PlatformAdminPageAccess =
  | { kind: "allowed"; actor: AdminActorViewModel }
  | { kind: "unauthenticated" }
  | { kind: "denied" };

export async function resolvePlatformAdminPageAccess(
  requireAccess: () => Promise<PlatformAdminPageSession>,
): Promise<PlatformAdminPageAccess> {
  try {
    const session = await requireAccess();

    return {
      kind: "allowed",
      actor: createAdminActorViewModel(session),
    };
  } catch (error) {
    if (error instanceof OperatorApiError && error.status === 401) {
      return { kind: "unauthenticated" };
    }

    if (error instanceof OperatorApiError && error.status === 403) {
      return { kind: "denied" };
    }

    throw error;
  }
}

export function createAdminActorViewModel(
  session: PlatformAdminPageSession,
): AdminActorViewModel {
  const displayName =
    session.operator.displayName?.trim() || session.operator.name.trim();

  return {
    displayName,
    initials: getInitials(displayName),
    role: session.platformMembership.role,
  };
}

function getInitials(displayName: string) {
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("pl") ?? "")
    .join("");

  return initials || "PN";
}
