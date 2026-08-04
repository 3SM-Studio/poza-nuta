import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  generateOrganizationPublicId,
  isOrganizationPublicId,
} from "../src/lib/organization-public-id.ts";
import { buildOwnerWorkspaceMembershipInput } from "../src/lib/organization-workspace.ts";
import {
  resolveDashboardOrganizationAccess,
  type DashboardOrganizationAccessTarget,
} from "../src/lib/dashboard-organization-access.ts";
import {
  getDashboardOrganizationIdFromPath,
  LAST_SELECTED_ORGANIZATION_COOKIE,
  isLastSelectedOrganizationId,
} from "../src/lib/dashboard-last-selected-organization.ts";
import {
  getDashboardNewOrganizationPath,
  getDashboardOrganizationsPath,
  getDashboardOrganizationEventCompatibilityRedirectPath,
  getDashboardOrganizationEventPath,
  getDashboardOrganizationEventQueuePath,
  getDashboardOrganizationEventSettingsPath,
  getDashboardOrganizationEventSharePath,
  getDashboardOrganizationEventsPath,
  getDashboardOrganizationGeneralSettingsPath,
  getDashboardOrganizationNewEventPath,
  getDashboardOrganizationPath,
  getDashboardOrganizationSettingsPath,
  getDashboardOrganizationTeamPath,
  isDashboardNavigationLinkActive,
  resolveDashboardHomeRedirect,
} from "../src/lib/dashboard-routes.ts";
import {
  CanonicalSiteOriginConfigurationError,
  parseCanonicalSiteOrigin,
} from "../src/lib/canonical-site-origin.ts";
import { sanitizeAuthIdentities } from "../src/server/operator-api/account.ts";

const exampleOrganizationId = "kgbgnpwpbcaebdytjmbx";
const otherOrganizationId = "aaaaaaaaaaaaaaaaaaaa";
const exampleEventPublicId = "123e4567-e89b-42d3-a456-426614174000";

test("organization public IDs use twenty lowercase alphanumeric characters", () => {
  const publicId = generateOrganizationPublicId();

  assert.equal(publicId.length, 20);
  assert.equal(isOrganizationPublicId(publicId), true);
  assert.equal(isOrganizationPublicId("pozanuta"), false);
  assert.equal(isOrganizationPublicId("KGBGNPWPBCAEBDYTJMBX"), false);
});

test("organization route helpers encode organizationId values", () => {
  assert.equal(getDashboardOrganizationsPath(), "/dashboard/organizations");
  assert.equal(getDashboardNewOrganizationPath(), "/dashboard/new");
  assert.equal(
    getDashboardOrganizationPath(exampleOrganizationId),
    `/dashboard/org/${exampleOrganizationId}`,
  );
  assert.equal(
    getDashboardOrganizationEventsPath(exampleOrganizationId),
    `/dashboard/org/${exampleOrganizationId}/events`,
  );
  assert.equal(
    getDashboardOrganizationNewEventPath(exampleOrganizationId),
    `/dashboard/org/${exampleOrganizationId}/events/new`,
  );
  assert.equal(
    getDashboardOrganizationEventPath(exampleOrganizationId, exampleEventPublicId),
    `/dashboard/org/${exampleOrganizationId}/events/${exampleEventPublicId}`,
  );
  assert.equal(
    getDashboardOrganizationEventQueuePath(exampleOrganizationId, exampleEventPublicId),
    `/dashboard/org/${exampleOrganizationId}/events/${exampleEventPublicId}/queue`,
  );
  assert.equal(
    getDashboardOrganizationEventSharePath(exampleOrganizationId, exampleEventPublicId),
    `/dashboard/org/${exampleOrganizationId}/events/${exampleEventPublicId}/share`,
  );
  assert.equal(
    getDashboardOrganizationEventSettingsPath(exampleOrganizationId, exampleEventPublicId),
    `/dashboard/org/${exampleOrganizationId}/events/${exampleEventPublicId}/settings`,
  );
  assert.equal(
    getDashboardOrganizationSettingsPath(exampleOrganizationId),
    `/dashboard/org/${exampleOrganizationId}/settings`,
  );
  assert.equal(
    getDashboardOrganizationGeneralSettingsPath(exampleOrganizationId),
    `/dashboard/org/${exampleOrganizationId}/settings/general`,
  );
  assert.equal(
    getDashboardOrganizationTeamPath(exampleOrganizationId),
    `/dashboard/org/${exampleOrganizationId}/team`,
  );
});

test("legacy numeric event routes preserve their suffix when redirecting to the public UUID", () => {
  const expectedBase =
    `/dashboard/org/${exampleOrganizationId}/events/${exampleEventPublicId}`;

  assert.equal(
    getDashboardOrganizationEventCompatibilityRedirectPath(
      exampleOrganizationId,
      exampleEventPublicId,
      "detail",
    ),
    expectedBase,
  );
  assert.equal(
    getDashboardOrganizationEventCompatibilityRedirectPath(
      exampleOrganizationId,
      exampleEventPublicId,
      "queue",
    ),
    `${expectedBase}/queue`,
  );
  assert.equal(
    getDashboardOrganizationEventCompatibilityRedirectPath(
      exampleOrganizationId,
      exampleEventPublicId,
      "share",
    ),
    `${expectedBase}/share`,
  );
  assert.equal(
    getDashboardOrganizationEventCompatibilityRedirectPath(
      exampleOrganizationId,
      exampleEventPublicId,
      "settings",
    ),
    `${expectedBase}/settings`,
  );
});

test("legacy numeric event compatibility is authorized at the routing edge", () => {
  const compatibilitySource = readFileSync(
    "src/server/operator-api/event-route-compatibility.ts",
    "utf8",
  );
  const routeSources = [
    {
      path: "src/app/dashboard/org/[organizationId]/events/[eventId]/page.tsx",
      suffix: "detail",
    },
    {
      path: "src/app/dashboard/org/[organizationId]/events/[eventId]/queue/page.tsx",
      suffix: "queue",
    },
    {
      path: "src/app/dashboard/org/[organizationId]/events/[eventId]/share/page.tsx",
      suffix: "share",
    },
    {
      path: "src/app/dashboard/org/[organizationId]/events/[eventId]/settings/page.tsx",
      suffix: "settings",
    },
  ] as const;

  assert.match(compatibilitySource, /import "server-only"/);
  assert.match(compatibilitySource, /\^\[1-9\]\\d\*\$/);
  assert.match(
    compatibilitySource,
    /getDashboardOrganizationForAuthUser\([\s\S]*eq\(events\.workspaceId, organization\.id\)[\s\S]*eq\(events\.id, numericEventId\)/,
  );
  assert.ok(
    compatibilitySource.indexOf("getDashboardOrganizationForAuthUser(") <
      compatibilitySource.indexOf("eq(events.id, numericEventId)"),
  );
  assert.equal(
    (compatibilitySource.match(/return \{ kind: "not_found" \}/g) ?? [])
      .length,
    3,
  );

  for (const route of routeSources) {
    const source = readFileSync(route.path, "utf8");
    const auth = source.indexOf("requireOperatorSession()");
    const resolution = source.indexOf(
      "resolveDashboardEventRouteForAuthUser({",
    );

    assert.ok(auth >= 0 && resolution > auth, route.path);
    assert.match(source, /routeResolution\.kind === "legacy_redirect"/);
    assert.match(
      source,
      new RegExp(
        `getDashboardOrganizationEventCompatibilityRedirectPath\\([\\s\\S]*"${route.suffix}"`,
      ),
    );
    assert.match(source, /eventId: routeResolution\.eventPublicId/);
  }

  const layoutSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/layout.tsx",
    "utf8",
  );
  assert.ok(
    layoutSource.indexOf("requireOperatorSession()") <
      layoutSource.indexOf("resolveDashboardEventRouteForAuthUser({"),
  );
  assert.match(layoutSource, /eventId: routeResolution\.eventPublicId/);
});

test("dashboard home redirects users without organizations to onboarding", () => {
  assert.equal(resolveDashboardHomeRedirect([]), "/dashboard/new");
});

test("dashboard home redirects a single organization to its overview", () => {
  assert.equal(
    resolveDashboardHomeRedirect([{ publicId: exampleOrganizationId }]),
    `/dashboard/org/${exampleOrganizationId}`,
  );
});

test("dashboard home uses valid last selected organization preference", () => {
  assert.equal(
    resolveDashboardHomeRedirect(
      [
        { publicId: exampleOrganizationId },
        { publicId: otherOrganizationId },
      ],
      otherOrganizationId,
    ),
    `/dashboard/org/${otherOrganizationId}`,
  );
});

test("dashboard home ignores last selected without active membership", () => {
  assert.equal(
    resolveDashboardHomeRedirect(
      [
        { publicId: exampleOrganizationId },
        { publicId: otherOrganizationId },
      ],
      "bbbbbbbbbbbbbbbbbbbb",
    ),
    "/dashboard/organizations",
  );
});

test("dashboard home redirects multiple organizations to chooser without last selected", () => {
  assert.equal(
    resolveDashboardHomeRedirect([
      { publicId: exampleOrganizationId },
      { publicId: otherOrganizationId },
    ]),
    "/dashboard/organizations",
  );
});

test("dashboard page uses organization redirect router", () => {
  const source = readFileSync("src/app/dashboard/page.tsx", "utf8");

  assert.match(
    source,
    /resolveDashboardHomeRedirect\(organizations, lastSelectedOrganizationId\)/,
  );
  assert.match(source, /LAST_SELECTED_ORGANIZATION_COOKIE/);
  assert.match(source, /listDashboardOrganizationsForAuthUser/);
  assert.equal(source.includes("DashboardOverview"), false);
});

test("legacy organization create route redirects to dashboard new", () => {
  const source = readFileSync(
    "src/app/dashboard/organizations/new/page.tsx",
    "utf8",
  );

  assert.match(source, /getDashboardNewOrganizationPath\(\)/);
  assert.match(source, /redirect\(/);
  assert.equal(source.includes("createDashboardOrganizationForOperator"), false);
});

test("dashboard new is canonical create organization route", () => {
  const source = readFileSync("src/app/dashboard/new/page.tsx", "utf8");
  const actionStart = source.indexOf("async function createOrganization");
  const actionSource = source.slice(actionStart);

  assert.match(source, /Utwórz nową organizację/);
  assert.match(source, /Organizacje grupują Twoje wydarzenia karaoke/);
  assert.match(source, /Typ/);
  assert.match(source, /Osobista/);
  assert.match(source, /Plan/);
  assert.match(source, /Darmowy/);
  assert.match(source, /Anuluj/);
  assert.match(source, /Utwórz organizację/);
  assert.match(source, /createDashboardOrganizationForOperator/);
  assert.match(source, /getDashboardOrganizationPath\(organization\.publicId\)/);
  assert.match(actionSource, /revalidatePath\("\/dashboard", "layout"\)/);
  assert.match(actionSource, /revalidatePath\(getDashboardOrganizationsPath\(\)\)/);
  assert.ok(
    actionSource.indexOf('revalidatePath("/dashboard", "layout")') <
      actionSource.indexOf("redirect(getDashboardOrganizationPath"),
  );
  assert.match(actionSource, /formData\.get\("name"\)/);
  assert.equal(actionSource.includes('formData.get("type")'), false);
  assert.equal(actionSource.includes('formData.get("plan")'), false);
});

test("organizations chooser links to organization public IDs and canonical create", () => {
  const source = readFileSync(
    "src/app/dashboard/organizations/page.tsx",
    "utf8",
  );

  assert.match(source, /Twoje organizacje/);
  assert.match(source, /Utwórz organizację/);
  assert.match(source, /Otwórz/);
  assert.match(source, /ID organizacji:/);
  assert.match(source, /Rola:/);
  assert.match(source, /getDashboardOrganizationPath\(organization\.publicId\)/);
  assert.match(source, /getDashboardNewOrganizationPath\(\)/);
  assert.equal(source.includes("/dashboard/organizations/new"), false);
});

test("organization settings uses canonical settings path", () => {
  assert.equal(
    getDashboardOrganizationSettingsPath(exampleOrganizationId),
    `/dashboard/org/${exampleOrganizationId}/settings`,
  );
  assert.equal(
    getDashboardOrganizationGeneralSettingsPath(exampleOrganizationId),
    `/dashboard/org/${exampleOrganizationId}/settings/general`,
  );
});

test("organization general settings page redirects to canonical settings", () => {
  const source = readFileSync(
    "src/app/dashboard/org/[organizationId]/settings/general/page.tsx",
    "utf8",
  );

  assert.match(source, /getDashboardOrganizationSettingsPath\(organizationId\)/);
  assert.equal(source.includes("settings/general"), false);
});

test("dashboard organization links use settings canonical path", () => {
  const sidebarSource = readFileSync(
    "src/components/operator/organizer-sidebar.tsx",
    "utf8",
  );
  const overviewSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/page.tsx",
    "utf8",
  );

  assert.match(sidebarSource, /getDashboardOrganizationSettingsPath/);
  assert.match(overviewSource, /getDashboardOrganizationSettingsPath/);
  assert.equal(
    sidebarSource.includes("getDashboardOrganizationGeneralSettingsPath"),
    false,
  );
  assert.equal(
    overviewSource.includes("getDashboardOrganizationGeneralSettingsPath"),
    false,
  );
});

test("organization settings mutations require owner access", () => {
  const source = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );

  assert.match(source, /updateDashboardOrganizationNameForAuthUser/);
  assert.match(source, /archiveDashboardOrganizationForAuthUser/);
  assert.match(source, /requireOwnerOrganizationInTransaction/);
  assert.match(source, /eq\(workspaceMembers\.role, "owner"\)/);
});

test("organization archive soft deletes workspace without hard delete", () => {
  const source = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );
  const archiveStart = source.indexOf(
    "export async function archiveDashboardOrganizationForAuthUser",
  );
  const archiveEnd = source.indexOf(
    "export async function createDashboardOrganizationForOperator",
  );
  const archiveSource = source.slice(archiveStart, archiveEnd);

  assert.match(archiveSource, /\.update\(workspaces\)/);
  assert.match(archiveSource, /active: false/);
  assert.equal(archiveSource.includes(".delete("), false);
  assert.equal(archiveSource.includes("events"), false);
  assert.equal(archiveSource.includes("songRequests"), false);
});

test("organization danger zone requires publicId confirmation before archive", () => {
  const settingsSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/settings/page.tsx",
    "utf8",
  );
  const dangerSource = readFileSync(
    "src/components/operator/archive-organization-form.tsx",
    "utf8",
  );

  assert.match(settingsSource, /confirmationOrganizationId !== organizationId/);
  assert.match(settingsSource, /Organization archive confirmation did not match/);
  assert.match(dangerSource, /Strefa niebezpieczna/);
  assert.match(dangerSource, /confirmation === organizationId/);
  assert.match(dangerSource, /name="confirmationOrganizationId"/);
  assert.match(dangerSource, /Zarchiwizuj organizację/);
  assert.match(dangerSource, /disabled=\{!canArchive \|\| !isConfirmed\}/);
  assert.match(dangerSource, /nie usunie fizycznie wydarzeń/);
  assert.match(dangerSource, /Wpisz ID organizacji, aby potwierdzić/);
  assert.equal(/permanent/i.test(dangerSource), false);
  assert.equal(/hard delete/i.test(dangerSource), false);
});

test("organization team route requires membership before exposing members", () => {
  const pageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/team/page.tsx",
    "utf8",
  );
  const serviceSource = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );

  assert.match(pageSource, /listDashboardOrganizationMembersForAuthUser/);
  assert.match(pageSource, /notFound\(\)/);
  assert.match(serviceSource, /listDashboardOrganizationMembersForAuthUser/);
  assert.match(serviceSource, /getDashboardOrganizationForAuthUser/);
  assert.match(serviceSource, /eq\(workspaceMembers\.workspaceId, organization\.id\)/);
});

test("organization overview requires membership before exposing metrics", () => {
  const pageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/page.tsx",
    "utf8",
  );
  const serviceSource = readFileSync(
    "src/server/operator-api/organization-overview.ts",
    "utf8",
  );

  assert.match(pageSource, /getDashboardOrganizationOverviewForAuthUser/);
  assert.match(pageSource, /notFound\(\)/);
  assert.match(serviceSource, /getDashboardOrganizationForAuthUser/);
  assert.match(serviceSource, /if \(!organization\) \{\s+return null;/);
});

test("organization overview queries are scoped to workspace public access target", () => {
  const source = readFileSync(
    "src/server/operator-api/organization-overview.ts",
    "utf8",
  );

  assert.match(source, /getOverviewStatsForWorkspace\(\{/);
  assert.match(source, /workspaceId: organization\.id/);
  assert.match(source, /countEventStatsForWorkspace\(input\.workspaceId\)/);
  assert.match(source, /countRequestStatsForWorkspace\(\{/);
  assert.match(source, /getRecentEventsForWorkspace\(organization\.id\)/);
  assert.match(source, /getTopRequestedSongsForWorkspace\(organization\.id\)/);
  assert.match(source, /eq\(events\.workspaceId, workspaceId\)/);
  assert.match(source, /innerJoin\(events, eq\(events\.id, songRequests\.eventId\)\)/);
  assert.match(source, /innerJoin\(songs, eq\(songs\.id, songRequests\.songId\)\)/);
  assert.equal(source.includes("eq(workspaces.handle, organizationId)"), false);
});

test("organization overview renders empty states and no fake dashboard data", () => {
  const source = readFileSync(
    "src/app/dashboard/org/[organizationId]/page.tsx",
    "utf8",
  );

  assert.match(source, /overview\.stats\.activeEvents/);
  assert.match(source, /overview\.stats\.requestsToday/);
  assert.match(source, /overview\.stats\.pendingRequests/);
  assert.match(source, /overview\.stats\.catalogSongs/);
  assert.match(source, /Utwory w globalnym katalogu/);
  assert.equal(source.includes("Global catalog songs"), false);
  assert.match(source, /overview\.recentEvents\.length > 0/);
  assert.match(source, /overview\.topRequestedSongs\.length > 0/);
  assert.match(source, /Brak wydarzeń/);
  assert.match(source, /Brak requestów/);
  assert.match(source, /overview\.partialFailures\.counts/);
  assert.match(source, /overview\.partialFailures\.activeEvent/);
  assert.match(source, /ostatnie 30 dni/);
  assert.equal(source.includes("Math.random"), false);
  assert.equal(source.includes("placeholder"), false);
  assert.equal(source.includes("fake"), false);
});

test("dashboard shell uses separate simple organization and account layouts", () => {
  const shellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );

  assert.match(shellSource, /<AppShell/);
  assert.match(shellSource, /kind="dashboard"/);
  assert.match(shellSource, /layout=\{layout\}/);
  assert.match(shellSource, /<OrganizerSidebar/);
  assert.match(shellSource, /organizationId\s+\?\s+"organization"/);
  assert.match(shellSource, /:\s+isAccountRoute\s+\?\s+"account"/);
  assert.match(shellSource, /:\s+"simple"/);
  assert.match(shellSource, /pathname\.startsWith\("\/account"\)/);
  assert.match(shellSource, /getSelectedOrganizationId\(pathname\)/);
});

test("global theme exposes light and dark shadcn and sidebar tokens", () => {
  const globalsSource = readFileSync("src/app/globals.css", "utf8");
  const sidebarSource = readFileSync("src/components/ui/sidebar.tsx", "utf8");
  const buttonSource = readFileSync("src/components/ui/button.tsx", "utf8");
  const cardSource = readFileSync("src/components/ui/card.tsx", "utf8");

  for (const token of [
    "--background",
    "--foreground",
    "--card",
    "--card-foreground",
    "--popover",
    "--popover-foreground",
    "--primary",
    "--primary-foreground",
    "--secondary",
    "--muted",
    "--muted-foreground",
    "--accent",
    "--border",
    "--input",
    "--ring",
    "--chart-1",
    "--chart-2",
    "--chart-3",
    "--chart-4",
    "--chart-5",
    "--sidebar",
    "--sidebar-foreground",
    "--sidebar-accent",
    "--sidebar-border",
  ]) {
    assert.match(globalsSource, new RegExp(`${token}:`));
  }

  assert.match(globalsSource, /color-scheme: dark/);
  assert.match(globalsSource, /html\.light\s*\{/);
  assert.match(globalsSource, /color-scheme: light/);
  assert.match(globalsSource, /html\.dark\s*\{/);
  assert.match(globalsSource, /oklch\(/);
  assert.match(sidebarSource, /bg-sidebar/);
  assert.match(sidebarSource, /bg-background/);
  assert.match(buttonSource, /shadow-\[var\(--shadow-accent-soft\)\]/);
  assert.match(cardSource, /shadow-\[var\(--shadow-card\)\]/);
});

test("dashboard uses the shared header without duplicating the organization switcher", () => {
  const shellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );
  assert.match(shellSource, /section="Panel organizatora"/);
  assert.match(shellSource, /title=\{title\}/);
  assert.match(shellSource, /organizations=\{organizations\}/);
  assert.equal(shellSource.includes("headerContext="), false);
  assert.equal(shellSource.includes("DashboardOrganizationSwitcher"), false);
  assert.equal(shellSource.includes("DashboardUserMenu"), false);
});

test("simple dashboard routes keep the organizer sidebar with real destinations", () => {
  const sidebarSource = readFileSync(
    "src/components/operator/organizer-sidebar.tsx",
    "utf8",
  );

  assert.match(sidebarSource, /return \[panelGroup\]/);
  assert.match(sidebarSource, /getDashboardNewOrganizationPath\(\)/);
  assert.match(sidebarSource, /getDashboardOrganizationsPath\(\)/);
  assert.equal(sidebarSource.includes('href: "#"'), false);
});

test("organization routes use a dedicated typed organizer navigation", () => {
  const sidebarSource = readFileSync(
    "src/components/operator/organizer-sidebar.tsx",
    "utf8",
  );

  assert.match(sidebarSource, /export function getOrganizerNavigationGroups/);
  assert.match(sidebarSource, /label: "Przegl/);
  assert.match(sidebarSource, /label: "Wydarzenia"/);
  assert.match(sidebarSource, /label: "Zesp/);
  assert.match(sidebarSource, /label: "Ustawienia"/);
  assert.match(sidebarSource, /<DashboardOrganizationSwitcher/);
  assert.match(sidebarSource, /header=\{/);
  assert.equal(/label: "(Overview|Events|Team|Settings)"/.test(sidebarSource), false);
});

test("account routes contain only real profile and security destinations", () => {
  const sidebarSource = readFileSync(
    "src/components/operator/organizer-sidebar.tsx",
    "utf8",
  );

  assert.match(sidebarSource, /label: "Konto"/);
  assert.match(sidebarSource, /label: "Profil"/);
  assert.match(sidebarSource, /label: "Bezpiecze/);
  assert.match(sidebarSource, /href: "\/account"/);
  assert.match(sidebarSource, /href: "\/account\/security"/);
  assert.equal(sidebarSource.includes("Dziennik audytu"), false);
  assert.equal(sidebarSource.includes("Wkrótce"), false);
  assert.equal(/Back to dashboard|Profile|Security|Audit logs/.test(sidebarSource), false);
});

test("account profile page renders read-only Polish profile labels", () => {
  const source = readFileSync(
    "src/app/account/page.tsx",
    "utf8",
  );

  assert.match(source, /Profil użytkownika/);
  assert.match(source, /Email/);
  assert.match(source, /Auth user ID/);
  assert.match(source, /ImiÄ™ i nazwisko|Imię i nazwisko/);
  assert.match(source, /Techniczna nazwa operatora/);
  assert.match(source, /Status operatora/);
  assert.match(source, /Aktywny/);
  assert.match(source, /Edycja profilu będzie dostępna/);
  assert.match(source, /Metody logowania/);
  assert.equal(source.includes("DashboardOrganizationSwitcher"), false);
  assert.equal(source.includes("service_role"), false);
});

test("account security page renders login methods as read-only placeholders", () => {
  const source = readFileSync(
    "src/app/account/security/page.tsx",
    "utf8",
  );

  assert.match(source, /Logowanie/);
  assert.match(source, /Metody logowania/);
  assert.match(source, /Hasło \/ Email/);
  assert.match(source, /Google · Wkrótce/);
  assert.match(source, /MFA · Wkrótce/);
  assert.match(source, /nie\s+uruchamia OAuth/);
  assert.match(source, /requireOperatorSession/);
  assert.match(source, /sanitizeAuthIdentities/);
  assert.equal(source.includes("signInWithOAuth"), false);
  assert.equal(source.includes("linkIdentity"), false);
  assert.equal(source.includes("unlinkIdentity"), false);
  assert.equal(source.includes("auth/callback"), false);
  assert.equal(source.includes("DashboardOrganizationSwitcher"), false);
});

test("dashboard shell resolves titles for the shared site header", () => {
  const shellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );
  const headerSource = readFileSync(
    "src/components/app-shell/site-header.tsx",
    "utf8",
  );

  assert.match(shellSource, /getDashboardPageTitle/);
  assert.match(shellSource, /return "Ustawienia"/);
  assert.match(shellSource, /return "Konto"/);
  assert.match(shellSource, /return "Bezpiecze/);
  assert.match(shellSource, /return "Nowa organizacja"/);
  assert.match(headerSource, /data-site-header="true"/);
  assert.match(headerSource, /<Breadcrumb>/);
  assert.match(headerSource, /<BreadcrumbSeparator/);
  assert.match(headerSource, /<BreadcrumbPage/);
  assert.equal(shellSource.includes("DashboardContentHeader"), false);
  assert.equal(shellSource.includes("dashboardContentHeader"), false);
});

test("organization switcher is rendered once in the organizer sidebar header", () => {
  const sidebarSource = readFileSync(
    "src/components/operator/organizer-sidebar.tsx",
    "utf8",
  );
  const shellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );

  assert.match(sidebarSource, /<DashboardOrganizationSwitcher/);
  assert.match(sidebarSource, /header=\{/);
  assert.equal(shellSource.includes("DashboardOrganizationSwitcher"), false);
});

test("dashboard breadcrumbs render separator as a BreadcrumbList sibling", () => {
  const headerSource = readFileSync(
    "src/components/app-shell/site-header.tsx",
    "utf8",
  );
  const itemBlocks = headerSource.match(
    /<BreadcrumbItem[\s\S]*?<\/BreadcrumbItem>/g,
  ) ?? [];

  assert.ok(itemBlocks.length > 0);
  assert.match(headerSource, /<BreadcrumbSeparator/);
  assert.equal(
    itemBlocks.some((block) => block.includes("BreadcrumbSeparator")),
    false,
  );
});

test("account is in avatar menu and not a main header nav link", () => {
  const userMenuSource = readFileSync(
    "src/components/app-shell/app-sidebar-user.tsx",
    "utf8",
  );

  assert.match(userMenuSource, /href="\/account"/);
  assert.match(userMenuSource, /label="Konto"/);
  assert.match(userMenuSource, /Wyloguj/);
});

test("legacy dashboard account routes redirect to the global account", () => {
  const accountRedirect = readFileSync(
    "src/app/dashboard/account/page.tsx",
    "utf8",
  );
  const profileRedirect = readFileSync(
    "src/app/dashboard/account/me/page.tsx",
    "utf8",
  );
  const securityRedirect = readFileSync(
    "src/app/dashboard/account/security/page.tsx",
    "utf8",
  );
  const proxySource = readFileSync("src/proxy.ts", "utf8");

  assert.match(accountRedirect, /redirect\("\/account"\)/);
  assert.match(profileRedirect, /redirect\("\/account"\)/);
  assert.match(securityRedirect, /redirect\("\/account\/security"\)/);
  assert.match(proxySource, /"\/account\/:path\*"/);
});

test("sidebar inset owns its border and clips the sticky header to its radius", () => {
  const sidebarSource = readFileSync("src/components/ui/sidebar.tsx", "utf8");

  assert.match(sidebarSource, /md:overflow-clip/);
  assert.match(sidebarSource, /md:border md:border-border/);
  assert.equal(sidebarSource.includes("md:ring-1 md:ring-border"), false);
  assert.match(sidebarSource, /data-slot="sidebar-content"[\s\S]*?overflow-y-auto/);
});

test("dashboard logo links to dashboard while the public request logo links home", () => {
  const appSidebarSource = readFileSync(
    "src/components/app-shell/app-sidebar.tsx",
    "utf8",
  );
  const publicRequestSource = readFileSync(
    "src/components/public/public-request-page.tsx",
    "utf8",
  );
  assert.match(
    appSidebarSource,
    /homeHref[\s\S]*?<Link href=\{homeHref\}/,
  );
  assert.match(
    publicRequestSource,
    /className=\{styles\.brand\}[\s\S]*?href="\/"/,
  );
});

test("dashboard organization navigation activates overview only on exact route", () => {
  const overviewPath = getDashboardOrganizationPath(exampleOrganizationId);
  const settingsPath =
    getDashboardOrganizationSettingsPath(exampleOrganizationId);
  const teamPath = getDashboardOrganizationTeamPath(exampleOrganizationId);
  const eventsPath = getDashboardOrganizationEventsPath(exampleOrganizationId);

  assert.equal(
    isDashboardNavigationLinkActive(overviewPath, overviewPath),
    true,
  );
  assert.equal(
    isDashboardNavigationLinkActive(settingsPath, overviewPath),
    false,
  );
  assert.equal(isDashboardNavigationLinkActive(teamPath, overviewPath), false);
  assert.equal(isDashboardNavigationLinkActive(eventsPath, overviewPath), false);
});

test("dashboard organization navigation activates section links on their routes", () => {
  const settingsPath =
    getDashboardOrganizationSettingsPath(exampleOrganizationId);
  const teamPath = getDashboardOrganizationTeamPath(exampleOrganizationId);
  const eventsPath = getDashboardOrganizationEventsPath(exampleOrganizationId);

  assert.equal(
    isDashboardNavigationLinkActive(settingsPath, settingsPath),
    true,
  );
  assert.equal(
    isDashboardNavigationLinkActive(`${settingsPath}/advanced`, settingsPath),
    true,
  );
  assert.equal(isDashboardNavigationLinkActive(teamPath, teamPath), true);
  assert.equal(isDashboardNavigationLinkActive(`${teamPath}/members`, teamPath), true);
  assert.equal(isDashboardNavigationLinkActive(eventsPath, eventsPath), true);
  assert.equal(
    isDashboardNavigationLinkActive(`${eventsPath}/upcoming`, eventsPath),
    true,
  );
});

test("organization dropdown links use organizationId route targets", () => {
  const switcherSource = readFileSync(
    "src/components/operator/dashboard-organization-switcher.tsx",
    "utf8",
  );

  assert.equal(
    getDashboardOrganizationPath(exampleOrganizationId),
    `/dashboard/org/${exampleOrganizationId}`,
  );
  assert.match(switcherSource, /Wszystkie organizacje/);
  assert.match(switcherSource, /Utw/);
});

test("organization resolver uses publicId and not handle fallback", () => {
  const source = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );

  assert.match(source, /eq\(workspaces\.publicId, organizationId\)/);
  assert.equal(source.includes("eq(workspaces.handle, organizationId)"), false);
  assert.equal(isOrganizationPublicId("pozanuta"), false);
});

test("dashboard org paths are stored as last selected organization cookie", () => {
  const source = readFileSync("src/lib/supabase/update-session.ts", "utf8");

  assert.equal(isLastSelectedOrganizationId(exampleOrganizationId), true);
  assert.equal(isLastSelectedOrganizationId("pozanuta"), false);
  assert.equal(
    getDashboardOrganizationIdFromPath(
      `/dashboard/org/${exampleOrganizationId}/settings`,
    ),
    exampleOrganizationId,
  );
  assert.equal(getDashboardOrganizationIdFromPath("/dashboard/organizations"), null);
  assert.match(source, /getDashboardOrganizationIdFromPath\(pathname\)/);
  assert.match(source, /LAST_SELECTED_ORGANIZATION_COOKIE/);
  assert.match(source, /path: "\/dashboard"/);
  assert.equal(LAST_SELECTED_ORGANIZATION_COOKIE, "last_selected_organization_id");
});

test("organization create flow builds owner membership values", () => {
  assert.deepEqual(
    buildOwnerWorkspaceMembershipInput({
      workspaceId: 10,
      operatorUserId: 20,
    }),
    {
      workspaceId: 10,
      operatorUserId: 20,
      role: "owner",
      active: true,
    },
  );
});

test("organization create flow returns workspace columns and composes owner role", () => {
  const source = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );
  const createStart = source.indexOf(
    "export async function createDashboardOrganizationForOperator",
  );
  const createEnd = source.indexOf(
    "async function generateUniqueOrganizationPublicId",
  );
  const createSource = source.slice(createStart, createEnd);

  assert.match(createSource, /\.insert\(workspaces\)/);
  assert.match(createSource, /\.returning\(workspaceSelection\)/);
  assert.equal(createSource.includes(".returning(organizationSelection)"), false);
  assert.match(createSource, /\.insert\(workspaceMembers\)/);
  assert.match(createSource, /role: "owner" as const/);
});

test("organization create flow handles handle collisions with suffixes", () => {
  const source = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );

  assert.match(source, /generateUniqueWorkspaceHandle/);
  assert.match(source, /const candidate = `\$\{baseHandle\}-\$\{suffix\}`/);
  assert.match(source, /suffix < 100/);
});

test("organization access denies missing or inactive membership target", () => {
  assert.deepEqual(resolveDashboardOrganizationAccess(null), {
    allowed: false,
    status: 404,
    code: "WORKSPACE_NOT_FOUND",
  });
  assert.deepEqual(
    resolveDashboardOrganizationAccess({
      id: 1,
      active: false,
    }),
    {
      allowed: false,
      status: 404,
      code: "WORKSPACE_NOT_FOUND",
    },
  );
});

test("organization access allows active membership target", () => {
  const organization: DashboardOrganizationAccessTarget & {
    id: number;
    publicId: string;
  } = {
    id: 1,
    publicId: exampleOrganizationId,
    active: true,
  };

  assert.deepEqual(resolveDashboardOrganizationAccess(organization), {
    allowed: true,
    organization,
  });
});

test("organization events support owner and manager create flow", () => {
  const listPageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/page.tsx",
    "utf8",
  );
  const newPageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/new/page.tsx",
    "utf8",
  );
  const detailPageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/page.tsx",
    "utf8",
  );
  const sharePageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/share/page.tsx",
    "utf8",
  );
  const settingsPageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/settings/page.tsx",
    "utf8",
  );
  const organizationsSource = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );

  assert.match(listPageSource, /Utwórz wydarzenie/);
  assert.match(listPageSource, /getDashboardOrganizationNewEventPath/);
  assert.match(newPageSource, /validateCreateDashboardEventInput/);
  assert.match(newPageSource, /createDashboardOrganizationEventForAuthUser/);
  assert.match(newPageSource, /getDashboardOrganizationEventPath/);
  assert.match(newPageSource, /formData\.get\("venue"\)/);
  assert.match(newPageSource, /formData\.has\("songRequestsEnabled"\)/);
  assert.match(newPageSource, /formData\.has\("publicQueueEnabled"\)/);
  assert.match(newPageSource, /formData\.has\("publicShowSongTitles"\)/);
  assert.match(newPageSource, /formData\.has\("isActivePublicEvent"\)/);
  assert.match(newPageSource, /redirect\(/);
  assert.match(sharePageSource, /EventSessionAccessPanel/);
  assert.match(sharePageSource, /result\.event\.sessionCode/);
  assert.match(detailPageSource, /result\.event\.autoCloseAt/);
  assert.match(settingsPageSource, /result\.event\.songRequestsEnabled/);
  assert.match(detailPageSource, /result\.event\.facebookUrl/);
  assert.match(
    organizationsSource,
    /or\(eq\(workspaceMembers\.role, "owner"\), eq\(workspaceMembers\.role, "manager"\)\)/,
  );
  assert.equal(
    organizationsSource.includes('eq(workspaceMembers.role, "viewer")'),
    false,
  );
});

test("organization event list and detail present the same effective closed status", () => {
  const listPageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/page.tsx",
    "utf8",
  );
  const detailPageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/page.tsx",
    "utf8",
  );
  const organizationsSource = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );
  const dashboardLifecycleSource = readFileSync(
    "src/lib/dashboard-event-lifecycle.ts",
    "utf8",
  );

  assert.match(
    listPageSource,
    /formatEventStatus\(event\.effectiveStatus\)/,
  );
  assert.match(
    organizationsSource,
    /effectiveStatus: getEffectiveEventLifecycleStatus\(event\)/,
  );
  assert.match(
    detailPageSource,
    /const lifecycleStatus = getDashboardEventLifecycleStatus\(result\.event\)/,
  );
  assert.match(
    dashboardLifecycleSource,
    /return getEffectiveEventLifecycleStatus\(/,
  );
  assert.match(listPageSource, /case "closed":\s+return "Zamknięte";/);
  assert.match(detailPageSource, /case "closed":\s+return "Zamknięte";/);
  assert.equal(listPageSource.includes('return "Zamknięty";'), false);
  assert.equal(detailPageSource.includes('return "Zamknięty";'), false);
});

test("organization event create persists scheduling and public visibility fields", () => {
  const schemaSource = readFileSync("src/db/schema.ts", "utf8");
  const migrationSource = readFileSync(
    "drizzle/0007_lonely_midnight.sql",
    "utf8",
  );
  const organizationsSource = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );

  assert.match(schemaSource, /facebookUrl: text\("facebook_url"\)/);
  assert.match(schemaSource, /endsAt: timestampColumn\("ends_at"\)\.notNull\(\)/);
  assert.match(schemaSource, /songRequestsEnabled: boolean\("song_requests_enabled"\)/);
  assert.match(migrationSource, /ADD COLUMN "facebook_url" text/);
  assert.equal(migrationSource.includes("ends_at"), false);
  assert.match(organizationsSource, /venue: input\.event\.venue/);
  assert.match(organizationsSource, /autoCloseAt: input\.event\.autoCloseAt/);
  assert.match(organizationsSource, /endsAt: input\.event\.autoCloseAt/);
  assert.match(organizationsSource, /facebookUrl: input\.event\.facebookUrl/);
  assert.match(
    organizationsSource,
    /songRequestsEnabled: input\.event\.songRequestsEnabled/,
  );
  assert.match(
    organizationsSource,
    /publicQueueEnabled: input\.event\.publicQueueEnabled/,
  );
  assert.match(
    organizationsSource,
    /publicShowSongTitles: input\.event\.publicShowSongTitles/,
  );
  assert.match(
    organizationsSource,
    /isActivePublicEvent: input\.event\.isActivePublicEvent/,
  );
  assert.match(organizationsSource, /ACTIVE_PUBLIC_EVENT_ALREADY_EXISTS/);
  assert.match(organizationsSource, /withSessionCodeCollisionRetry/);
  assert.match(organizationsSource, /sessionCode/);
});

test("organization event detail and settings keep one focused responsibility", () => {
  const detailPageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/page.tsx",
    "utf8",
  );
  const settingsPageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/settings/page.tsx",
    "utf8",
  );
  const panelSource = readFileSync(
    "src/components/operator/event-management-panel.tsx",
    "utf8",
  );

  assert.match(detailPageSource, /getDashboardEventLifecycleStatus/);
  assert.match(detailPageSource, /areDashboardEventRequestsOpen/);
  assert.doesNotMatch(detailPageSource, /EventManagementPanel|EventSessionAccessPanel/);
  assert.match(settingsPageSource, /shouldShowDashboardEventClosingWarning/);
  assert.match(settingsPageSource, /EventManagementPanel/);
  assert.match(settingsPageSource, /detailsAction=\{updateEventDetails\.bind/);
  assert.doesNotMatch(detailPageSource, /generateSessionLink/);
  assert.doesNotMatch(detailPageSource, /tryBuildCanonicalSiteUrl/);
  assert.match(panelSource, /Wydarzenie kończy się za mniej niż 30 minut/);
  assert.match(panelSource, /name="title"/);
  assert.match(panelSource, /name="venue"/);
  assert.match(panelSource, /name="startsAt"/);
  assert.match(panelSource, /name="autoCloseAt"/);
  assert.match(panelSource, /name="facebookUrl"/);
  assert.match(panelSource, /name="songRequestsEnabled"/);
  assert.match(panelSource, /name="publicQueueEnabled"/);
  assert.match(panelSource, /name="publicShowSongTitles"/);
  assert.match(panelSource, /name="isActivePublicEvent"/);
  assert.match(panelSource, /Zamknij wydarzenie teraz/);
  assert.match(settingsPageSource, /sessionCode/);
});

test("canonical site origin accepts configured HTTP origins and normalizes trailing slashes", () => {
  assert.equal(
    parseCanonicalSiteOrigin("https://app.example.test"),
    "https://app.example.test",
  );
  assert.equal(
    parseCanonicalSiteOrigin("http://localhost:3000"),
    "http://localhost:3000",
  );
  assert.equal(
    parseCanonicalSiteOrigin("https://app.example.test/"),
    "https://app.example.test",
  );
});

test("canonical site origin rejects unsafe or ambiguous configuration", () => {
  for (const configuredValue of [
    "ftp://app.example.test",
    "https://user:password@app.example.test",
    "https://app.example.test?redirect=evil",
    "https://app.example.test#fragment",
  ]) {
    assert.throws(
      () => parseCanonicalSiteOrigin(configuredValue),
      (error) =>
        error instanceof CanonicalSiteOriginConfigurationError &&
        !error.message.includes(configuredValue),
    );
  }
});

test("canonical site origin fails safely when configuration is missing", () => {
  assert.throws(
    () => parseCanonicalSiteOrigin(undefined),
    (error) =>
      error instanceof CanonicalSiteOriginConfigurationError &&
      error.message === "Canonical site URL is not configured correctly.",
  );
});

test("canonical session share view uses the server-only origin helper", () => {
  const detailPageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/page.tsx",
    "utf8",
  );
  const sharePageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/share/page.tsx",
    "utf8",
  );
  const helperSource = readFileSync(
    "src/server/canonical-site-origin.ts",
    "utf8",
  );
  const panelSource = readFileSync(
    "src/components/operator/event-session-access-panel.tsx",
    "utf8",
  );
  const sessionAlertSource = readFileSync(
    "src/components/public/session-state-alert.tsx",
    "utf8",
  );

  for (const source of [detailPageSource, sharePageSource]) {
    assert.doesNotMatch(source, /process\.env\.SITE_URL|buildSessionUrl/);
    assert.doesNotMatch(source, /headers\(\)|x-forwarded-host|host\.startsWith/);
  }
  assert.doesNotMatch(detailPageSource, /tryBuildCanonicalSiteUrl/);
  assert.match(sharePageSource, /tryBuildCanonicalSiteUrl/);

  assert.match(helperSource, /import "server-only"/);
  assert.match(helperSource, /process\.env\.SITE_URL/);
  assert.doesNotMatch(
    helperSource,
    /headers\(\)|x-forwarded-host|request\.headers|host\.startsWith/,
  );
  assert.match(panelSource, /kind="canonical_unavailable"/);
  assert.match(sessionAlertSource, /Adres sesji jest chwilowo niedostępny/);
});

test("organization event management is limited to owner and manager roles", () => {
  const settingsPageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/settings/page.tsx",
    "utf8",
  );
  const organizationsSource = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );

  assert.match(settingsPageSource, /canManageDashboardOrganizationEvent/);
  assert.match(organizationsSource, /canManageDashboardOrganizationEvent/);
  assert.match(
    organizationsSource,
    /WORKSPACE_EVENT_MANAGE_FORBIDDEN/,
  );
  assert.match(
    organizationsSource,
    /or\(\s*eq\(workspaceMembers\.role, "owner"\),\s*eq\(workspaceMembers\.role, "manager"\),\s*\)/,
  );
  assert.equal(
    organizationsSource.includes('eq(workspaceMembers.role, "viewer")'),
    false,
  );
  assert.equal(
    organizationsSource.includes('eq(workspaceMembers.role, "operator")'),
    false,
  );
});

test("organization event management updates auto_close_at and closes without delete", () => {
  const organizationsSource = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );
  const manageStart = organizationsSource.indexOf(
    "export async function updateDashboardOrganizationEventAutoCloseAtForAuthUser",
  );
  const membersStart = organizationsSource.indexOf(
    "export async function listDashboardOrganizationMembersForAuthUser",
  );
  const manageSource = organizationsSource.slice(manageStart, membersStart);

  assert.match(manageSource, /updateDashboardOrganizationEventAutoCloseAtForAuthUser/);
  assert.match(manageSource, /updateDashboardOrganizationEventDetailsForAuthUser/);
  assert.match(manageSource, /extendDashboardOrganizationEventForAuthUser/);
  assert.match(manageSource, /closeDashboardOrganizationEventForAuthUser/);
  assert.match(manageSource, /startsAt: input\.event\.startsAt/);
  assert.match(manageSource, /autoCloseAt/);
  assert.match(manageSource, /endsAt/);
  assert.match(manageSource, /songRequestsEnabled/);
  assert.match(manageSource, /publicQueueEnabled/);
  assert.match(manageSource, /publicShowSongTitles/);
  assert.match(manageSource, /isActivePublicEvent/);
  assert.match(manageSource, /status: "closed"/);
  assert.match(manageSource, /closedAt: now/);
  assert.match(manageSource, /isActivePublicEvent: false/);
  assert.match(manageSource, /resolveDashboardEventCloseAt/);
  assert.equal(manageSource.includes(".delete("), false);
  assert.equal(manageSource.includes("ends_at"), false);
});

test("event management revalidates every lifecycle-dependent view", () => {
  const settingsPageSource = readFileSync(
    new URL(
      "../src/app/dashboard/org/[organizationId]/events/[eventId]/settings/page.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    settingsPageSource,
    /revalidatePath\(getDashboardOrganizationEventsPath\(/,
  );
  assert.match(
    settingsPageSource,
    /revalidatePath\([\s\S]*getDashboardOrganizationEventPath\(/,
  );
  assert.match(
    settingsPageSource,
    /revalidatePath\([\s\S]*getDashboardOrganizationEventQueuePath\(/,
  );
  assert.match(
    settingsPageSource,
    /revalidatePath\([\s\S]*getDashboardOrganizationEventSharePath\(/,
  );
  assert.match(settingsPageSource, /revalidatePath\(`\/join\/\$\{event\.sessionCode\}`\)/);
  assert.match(settingsPageSource, /revalidatePath\("\/s\/\[token\]", "page"\)/);
  assert.match(settingsPageSource, /revalidatePath\(`\/events\/\$\{event\.slug\}`\)/);
  assert.equal(
    (settingsPageSource.match(/revalidateManagedEventPaths\(result\)/g) ?? [])
      .length,
    5,
  );
});

test("organization event queue route renders the event-scoped management panel", () => {
  const queuePageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/queue/page.tsx",
    "utf8",
  );
  const sidebarSource = readFileSync(
    "src/components/operator/organizer-sidebar.tsx",
    "utf8",
  );

  assert.match(queuePageSource, /getDashboardOrganizationEventQueueForAuthUser/);
  assert.match(queuePageSource, /EventQueuePanel/);
  assert.match(queuePageSource, /Kolejka wydarzenia/);
  assert.doesNotMatch(queuePageSource, /Powrót do wydarzenia|Udostępnij/);
  assert.match(sidebarSource, /getDashboardOrganizationEventQueuePath/);
  assert.match(sidebarSource, /label: "Kolejka"/);
});

test("organization event share route renders canonical code and QR controls", () => {
  const sharePagePath =
    "src/app/dashboard/org/[organizationId]/events/[eventId]/share/page.tsx";
  const sharePageSource = readFileSync(sharePagePath, "utf8");
  const detailPageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/page.tsx",
    "utf8",
  );
  const queuePageSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/events/[eventId]/queue/page.tsx",
    "utf8",
  );
  const sharePanelSource = readFileSync(
    "src/components/operator/event-session-access-panel.tsx",
    "utf8",
  );
  const brandedQrSource = readFileSync(
    "src/lib/branded-session-qr.ts",
    "utf8",
  );
  const organizationsSource = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );

  assert.equal(existsSync(sharePagePath), true);
  assert.equal(
    getDashboardOrganizationEventSharePath(exampleOrganizationId, exampleEventPublicId),
    `/dashboard/org/${exampleOrganizationId}/events/${exampleEventPublicId}/share`,
  );
  assert.match(sharePageSource, /Udostępnij wydarzenie/);
  assert.match(sharePageSource, /getDashboardOrganizationEventSessionAccessForAuthUser/);
  assert.match(sharePageSource, /canShareDashboardOrganizationEvent/);
  assert.doesNotMatch(sharePageSource, /generateDashboardOrganizationEventShareLinkForAuthUser/);
  assert.match(sharePageSource, /notFound\(\)/);
  assert.match(sharePageSource, /result\.event\.sessionCode/);
  assert.match(sharePageSource, /`\/s\/\$\{result\.event\.publicToken\}`/);
  const sidebarSource = readFileSync(
    "src/components/operator/organizer-sidebar.tsx",
    "utf8",
  );
  assert.match(sidebarSource, /getDashboardOrganizationEventSharePath/);
  assert.match(sidebarSource, /label: "Link i QR"/);
  assert.doesNotMatch(detailPageSource, /Link i QR/);
  assert.doesNotMatch(queuePageSource, /Udostępnij/);
  assert.match(sharePanelSource, /createBrandedSessionQrSvg/);
  assert.match(sharePanelSource, /Pobierz QR \(SVG\)/);
  assert.match(brandedQrSource, /errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL/);
  assert.match(brandedQrSource, /const QR_ERROR_CORRECTION_LEVEL = "H"/);
  assert.match(brandedQrSource, /const QR_MARGIN_MODULES = 4/);
  assert.match(brandedQrSource, /QRCode\.create/);
  assert.match(brandedQrSource, /createModulesPath/);
  assert.match(brandedQrSource, /data-qr-brand-mark/);
  assert.doesNotMatch(brandedQrSource, /<image\b/);
  assert.doesNotMatch(brandedQrSource, /import .*AudioLinesIcon/);
  assert.match(brandedQrSource, /SESSION_QR_BRAND_ASSET_PATH/);
  assert.match(brandedQrSource, /data:image\/svg\+xml/);
  assert.doesNotMatch(sharePanelSource, /dangerouslySetInnerHTML/);
  assert.match(sharePanelSource, /Kopiuj kod/);
  assert.doesNotMatch(sharePanelSource, /Wygeneruj|Regeneruj/);
  assert.match(organizationsSource, /canShareDashboardOrganizationEvent/);
  assert.match(organizationsSource, /role === "operator"/);
  assert.equal(sharePageSource.includes("codeHash"), false);
  assert.equal(sharePanelSource.includes("codeHash"), false);
});

test("dashboard and admin shells use Tailwind without CSS Modules", () => {
  assert.equal(existsSync("src/components/operator/operator.module.css"), false);

  const roots = [
    "src/app/dashboard",
    "src/app/account",
    "src/components/operator",
    "src/components/platform-admin",
    "src/components/app-shell",
  ];
  const sources = roots.flatMap(listSourceFiles).map((path) => ({
    path,
    source: readFileSync(path, "utf8"),
  }));

  for (const { path, source } of sources) {
    assert.doesNotMatch(source, /\.module\.css|styles\.[A-Za-z]/, path);
  }
});

function listSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return /\.(?:ts|tsx)$/.test(path) ? [path] : [];
  });
}

test("account identity sanitizer exposes login methods without tokens", () => {
  const identities = sanitizeAuthIdentities([
    {
      provider: "email",
      id: "identity-row-id",
      identity_id: "identity-id",
      created_at: "2026-07-05T00:00:00.000Z",
      updated_at: "2026-07-05T00:01:00.000Z",
      last_sign_in_at: "2026-07-05T00:02:00.000Z",
      access_token: "secret-access-token",
      refresh_token: "secret-refresh-token",
      identity_data: {
        provider_token: "secret-provider-token",
      },
    },
  ]);

  assert.deepEqual(identities, [
    {
      provider: "email",
      id: "identity-row-id",
      identityId: "identity-id",
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:01:00.000Z",
      lastSignInAt: "2026-07-05T00:02:00.000Z",
    },
  ]);
  assert.equal(JSON.stringify(identities).includes("secret"), false);
});

test("session queue uses Supabase Realtime invalidation without data polling", () => {
  const sessionPageSource = readFileSync(
    "src/components/public/session-request-page.tsx",
    "utf8",
  );
  const hookSource = readFileSync(
    "src/components/realtime/use-queue-realtime.ts",
    "utf8",
  );

  assert.match(sessionPageSource, /usePublicQueueRealtime/);
  assert.match(hookSource, /\.on\("broadcast"/);
  assert.match(hookSource, /supabase\.removeChannel\(channel\)/);
  assert.match(hookSource, /new AbortController\(\)/);
  assert.equal(sessionPageSource.includes("public-queue-polling"), false);
  assert.equal(sessionPageSource.includes("setInterval"), false);
  assert.equal(sessionPageSource.includes("setTimeout"), false);
});

test("dashboard routes expose skeleton loading fallbacks", () => {
  const loadingRoutes = [
    "src/app/dashboard/loading.tsx",
    "src/app/dashboard/organizations/loading.tsx",
    "src/app/dashboard/new/loading.tsx",
    "src/app/account/loading.tsx",
    "src/app/account/security/loading.tsx",
    "src/app/dashboard/org/[organizationId]/loading.tsx",
    "src/app/dashboard/org/[organizationId]/events/loading.tsx",
    "src/app/dashboard/org/[organizationId]/team/loading.tsx",
    "src/app/dashboard/org/[organizationId]/settings/loading.tsx",
  ];
  const skeletonSource = readFileSync("src/components/ui/skeleton.tsx", "utf8");
  const dashboardSkeletonsSource = readFileSync(
    "src/components/operator/dashboard-skeletons.tsx",
    "utf8",
  );

  assert.match(skeletonSource, /data-slot="skeleton"/);
  assert.match(skeletonSource, /animate-pulse/);
  assert.match(dashboardSkeletonsSource, /export function DashboardPageSkeleton/);
  assert.match(dashboardSkeletonsSource, /export function PublicQueueSkeleton/);

  for (const route of loadingRoutes) {
    assert.equal(existsSync(route), true, `${route} should exist`);
    assert.match(readFileSync(route, "utf8"), /Skeleton/);
  }
});

test("global public queue page is removed and session queue handles refresh errors", () => {
  const queueRouteSource = readFileSync(
    "src/app/api/public/queue/route.ts",
    "utf8",
  );
  const source = readFileSync(
    "src/components/public/session-request-page.tsx",
    "utf8",
  );

  assert.equal(existsSync("src/app/queue/page.tsx"), false);
  assert.match(queueRouteSource, /PUBLIC_QUEUE_ENDPOINT_GONE/);
  assert.match(source, /queueMessage/);
  assert.match(source, /setQueueMessage\(getQueueErrorMessage\(caughtError\)\)/);
  assert.equal(source.includes("!error && queue?.enabled"), false);
  assert.equal(source.includes("!error && queue && !queue.enabled"), false);
});
