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
