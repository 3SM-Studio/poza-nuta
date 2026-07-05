export type DashboardOrganizationAccessTarget = {
  active: boolean;
};

export type DashboardOrganizationAccessResult<T> =
  | {
      allowed: true;
      organization: T;
    }
  | {
      allowed: false;
      status: 404;
      code: "WORKSPACE_NOT_FOUND";
    };

export function resolveDashboardOrganizationAccess<
  T extends DashboardOrganizationAccessTarget,
>(organization: T | null): DashboardOrganizationAccessResult<T> {
  if (!organization || !organization.active) {
    return {
      allowed: false,
      status: 404,
      code: "WORKSPACE_NOT_FOUND",
    };
  }

  return {
    allowed: true,
    organization,
  };
}
