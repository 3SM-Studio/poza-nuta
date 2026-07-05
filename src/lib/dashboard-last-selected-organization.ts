export const LAST_SELECTED_ORGANIZATION_COOKIE =
  "last_selected_organization_id";

export const LAST_SELECTED_ORGANIZATION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

const ORGANIZATION_PUBLIC_ID_PATTERN = /^[a-z0-9]{20}$/;

export function isLastSelectedOrganizationId(value: string) {
  return ORGANIZATION_PUBLIC_ID_PATTERN.test(value);
}

export function getDashboardOrganizationIdFromPath(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] !== "dashboard" || segments[1] !== "org" || !segments[2]) {
    return null;
  }

  let organizationId: string;

  try {
    organizationId = decodeURIComponent(segments[2]);
  } catch {
    return null;
  }

  return isLastSelectedOrganizationId(organizationId) ? organizationId : null;
}
