import { OperatorApiError } from "@/server/operator-api/errors";

import {
  hasPlatformPermission,
  type PlatformPermission,
  type PlatformRole,
} from "./policy";

export type ActivePlatformMembership = {
  id: number;
  operatorUserId: number;
  role: PlatformRole;
  active: true;
};

type OperatorSession = {
  operator: {
    id: number;
    active: true;
  };
};

type PlatformAdminGuardDependencies<TSession extends OperatorSession> = {
  requireOperatorSession: () => Promise<TSession>;
  findActivePlatformMembership: (
    operatorUserId: number,
  ) => Promise<ActivePlatformMembership | null>;
};

export async function authorizePlatformAdminSession<
  TSession extends OperatorSession,
>(
  permission: PlatformPermission,
  dependencies: PlatformAdminGuardDependencies<TSession>,
): Promise<TSession & { platformMembership: ActivePlatformMembership }> {
  const session = await dependencies.requireOperatorSession();
  const membership = await dependencies.findActivePlatformMembership(
    session.operator.id,
  );

  if (
    !membership ||
    membership.operatorUserId !== session.operator.id ||
    !hasPlatformPermission(membership.role, permission)
  ) {
    throw new OperatorApiError(
      403,
      "PLATFORM_ACCESS_DENIED",
      "Platform access is not permitted.",
    );
  }

  return {
    ...session,
    platformMembership: membership,
  };
}
