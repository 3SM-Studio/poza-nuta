type DashboardHomeOrganization = {
  publicId: string;
};

export function getDashboardOrganizationsPath() {
  return "/dashboard/organizations";
}

export function getDashboardNewOrganizationPath() {
  return "/dashboard/new";
}

export function getDashboardOrganizationPath(organizationId: string) {
  return `/dashboard/org/${encodeURIComponent(organizationId)}`;
}

export function getDashboardOrganizationEventsPath(organizationId: string) {
  return `${getDashboardOrganizationPath(organizationId)}/events`;
}

export function getDashboardOrganizationSettingsPath(organizationId: string) {
  return `${getDashboardOrganizationPath(organizationId)}/settings`;
}

export function getDashboardOrganizationGeneralSettingsPath(
  organizationId: string,
) {
  return `${getDashboardOrganizationSettingsPath(organizationId)}/general`;
}

export function getDashboardOrganizationTeamPath(organizationId: string) {
  return `${getDashboardOrganizationPath(organizationId)}/team`;
}

export function resolveDashboardHomeRedirect(
  organizations: DashboardHomeOrganization[],
  lastSelectedOrganizationId: string | null = null,
) {
  if (
    lastSelectedOrganizationId &&
    organizations.some(
      (organization) => organization.publicId === lastSelectedOrganizationId,
    )
  ) {
    return getDashboardOrganizationPath(lastSelectedOrganizationId);
  }

  if (organizations.length === 0) {
    return getDashboardNewOrganizationPath();
  }

  if (organizations.length === 1) {
    return getDashboardOrganizationPath(organizations[0].publicId);
  }

  return getDashboardOrganizationsPath();
}
