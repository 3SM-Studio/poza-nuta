type DashboardHomeOrganization = {
  publicId: string;
};

export function getDashboardOrganizationsPath() {
  return "/dashboard/organizations";
}

export function getDashboardNewOrganizationPath() {
  return "/dashboard/new";
}

export function getDashboardProfileOnboardingPath() {
  return "/dashboard/onboarding/profile";
}

export function getDashboardOrganizationPath(organizationId: string) {
  return `/dashboard/org/${encodeURIComponent(organizationId)}`;
}

export function getDashboardOrganizationEventsPath(organizationId: string) {
  return `${getDashboardOrganizationPath(organizationId)}/events`;
}

export function getDashboardOrganizationNewEventPath(organizationId: string) {
  return `${getDashboardOrganizationEventsPath(organizationId)}/new`;
}

export function getDashboardOrganizationEventPath(
  organizationId: string,
  eventId: number | string,
) {
  return `${getDashboardOrganizationEventsPath(
    organizationId,
  )}/${encodeURIComponent(String(eventId))}`;
}

export function getDashboardOrganizationEventQueuePath(
  organizationId: string,
  eventId: number | string,
) {
  return `${getDashboardOrganizationEventPath(organizationId, eventId)}/queue`;
}

export function getDashboardOrganizationEventSharePath(
  organizationId: string,
  eventId: number | string,
) {
  return `${getDashboardOrganizationEventPath(organizationId, eventId)}/share`;
}

export function getDashboardOrganizationEventSettingsPath(
  organizationId: string,
  eventId: number | string,
) {
  return `${getDashboardOrganizationEventPath(organizationId, eventId)}/settings`;
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

export function isDashboardNavigationLinkActive(
  pathname: string,
  href: string,
) {
  const currentPath = normalizeDashboardPath(pathname);
  const targetPath = normalizeDashboardPath(href);
  const targetSegments = targetPath.split("/").filter(Boolean);
  const isOrganizationOverviewLink =
    targetSegments[0] === "dashboard" &&
    targetSegments[1] === "org" &&
    targetSegments.length === 3;

  if (isOrganizationOverviewLink) {
    return currentPath === targetPath;
  }

  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
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

function normalizeDashboardPath(path: string) {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
}
