import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  getDashboardOrganizationEventsPath,
  getDashboardOrganizationGeneralSettingsPath,
  getDashboardOrganizationPath,
  getDashboardOrganizationSettingsPath,
  getDashboardOrganizationTeamPath,
  isDashboardNavigationLinkActive,
  resolveDashboardHomeRedirect,
} from "../src/lib/dashboard-routes.ts";
import { sanitizeAuthIdentities } from "../src/server/operator-api/account.ts";
import {
  PUBLIC_QUEUE_POLL_INTERVAL_MS,
  shouldPollPublicQueue,
} from "../src/components/public/public-queue-polling.ts";

const exampleOrganizationId = "kgbgnpwpbcaebdytjmbx";
const otherOrganizationId = "aaaaaaaaaaaaaaaaaaaa";

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
      actionSource.indexOf("redirect("),
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
  const shellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );
  const overviewSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/page.tsx",
    "utf8",
  );

  assert.match(shellSource, /getDashboardOrganizationSettingsPath/);
  assert.match(overviewSource, /getDashboardOrganizationSettingsPath/);
  assert.equal(
    shellSource.includes("getDashboardOrganizationGeneralSettingsPath"),
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

  assert.match(source, /countEventsForWorkspace\(organization\.id/);
  assert.match(source, /getRecentEventsForWorkspace\(organization\.id\)/);
  assert.match(source, /getTopRequestedSongsForWorkspace\(organization\.id\)/);
  assert.match(source, /workspaceId: organization\.id/);
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
  assert.equal(source.includes("Math.random"), false);
  assert.equal(source.includes("placeholder"), false);
  assert.equal(source.includes("fake"), false);
});

test("dashboard shell uses separate simple organization and account layouts", () => {
  const shellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );

  assert.match(shellSource, /data-dashboard-layout=\{layout\}/);
  assert.match(shellSource, /data-dashboard-topbar="true"/);
  assert.match(shellSource, /data-dashboard-body="true"/);
  assert.match(shellSource, /organizationId\s+\?\s+"organization"/);
  assert.match(shellSource, /:\s+isAccountRoute\s+\?\s+"account"/);
  assert.match(shellSource, /:\s+"simple"/);
  assert.match(shellSource, /pathname\.startsWith\("\/dashboard\/account"\)/);
  assert.match(shellSource, /getSelectedOrganizationId\(pathname\)/);
});

test("dashboard theme exposes dark shadcn and sidebar tokens", () => {
  const globalsSource = readFileSync("src/app/globals.css", "utf8");
  const operatorStyles = readFileSync(
    "src/components/operator/operator.module.css",
    "utf8",
  );
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
  assert.match(globalsSource, /oklch\(/);
  assert.match(operatorStyles, /background: var\(--sidebar\)/);
  assert.match(operatorStyles, /background: var\(--topbar-bg\)/);
  assert.match(operatorStyles, /box-shadow: var\(--shadow-accent/);
  assert.match(buttonSource, /shadow-\[var\(--shadow-accent-soft\)\]/);
  assert.match(cardSource, /shadow-\[var\(--shadow-card\)\]/);
});

test("dashboard topbar is global and renders breadcrumbs with organization switcher", () => {
  const shellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );
  const topbarStart = shellSource.indexOf('data-dashboard-topbar="true"');
  const topbarEnd = shellSource.indexOf('data-dashboard-body="true"');
  const topbarSource = shellSource.slice(topbarStart, topbarEnd);

  assert.match(topbarSource, /<DashboardLogo \/>/);
  assert.match(topbarSource, /<DashboardHeaderBreadcrumbs/);
  assert.match(topbarSource, /organizations=\{organizations\}/);
  assert.match(topbarSource, /<DashboardUserMenu/);
  assert.equal(topbarSource.includes("dashboardHeaderLabel"), false);
  assert.equal(topbarSource.includes("<strong>Dashboard</strong>"), false);
});

test("simple dashboard routes do not render organization sidebar", () => {
  const shellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );

  assert.match(shellSource, /sidebar\s+\?\s+styles\.dashboardBody/);
  assert.match(shellSource, /styles\.dashboardBodySimple/);
  assert.match(shellSource, /getDashboardNewOrganizationPath\(\)/);
  assert.match(shellSource, /getDashboardOrganizationsPath\(\)/);
});

test("organization routes render org sidebar navigation without org switcher", () => {
  const shellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );
  const sidebarStart = shellSource.indexOf("function OrganizationSidebar");
  const sidebarEnd = shellSource.indexOf("function AccountSidebar");
  const sidebarSource = shellSource.slice(sidebarStart, sidebarEnd);

  assert.match(shellSource, /function OrganizationSidebar/);
  assert.match(sidebarSource, /data-dashboard-org-sidebar="true"/);
  assert.match(sidebarSource, /label: "Przegl/);
  assert.match(sidebarSource, /label: "Wydarzenia"/);
  assert.match(sidebarSource, /label: "Zesp/);
  assert.match(sidebarSource, /label: "Ustawienia"/);
  assert.match(sidebarSource, /Wszystkie organizacje/);
  assert.match(sidebarSource, /Utw/);
  assert.equal(sidebarSource.includes("DashboardOrganizationSwitcher"), false);
  assert.equal(/label: "(Overview|Events|Team|Settings)"/.test(shellSource), false);
});

test("account routes render account sidebar without organization switcher", () => {
  const shellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );
  const accountStart = shellSource.indexOf("function AccountSidebar");
  const accountEnd = shellSource.indexOf("function DashboardLogo");
  const accountSource = shellSource.slice(accountStart, accountEnd);

  assert.match(accountSource, /data-dashboard-account-sidebar="true"/);
  assert.match(accountSource, /Wr/);
  assert.match(accountSource, /Profil/);
  assert.match(accountSource, /Bezpiecze/);
  assert.match(accountSource, /Dziennik audytu/);
  assert.match(accountSource, /Wkr/);
  assert.equal(/Back to dashboard|Profile|Security|Audit logs/.test(accountSource), false);
  assert.equal(accountSource.includes("DashboardOrganizationSwitcher"), false);
  assert.equal(accountSource.includes("data-dashboard-org-sidebar"), false);
  assert.match(shellSource, /\/dashboard\/account\/security/);
});

test("account profile page renders read-only Polish profile labels", () => {
  const source = readFileSync(
    "src/app/dashboard/account/me/page.tsx",
    "utf8",
  );

  assert.match(source, /Profil użytkownika/);
  assert.match(source, /Email/);
  assert.match(source, /Auth user ID/);
  assert.match(source, /Nazwa operatora/);
  assert.match(source, /Status operatora/);
  assert.match(source, /Aktywny/);
  assert.match(source, /Edycja profilu będzie dostępna/);
  assert.match(source, /Metody logowania/);
  assert.equal(source.includes("DashboardOrganizationSwitcher"), false);
  assert.equal(source.includes("service_role"), false);
});

test("account security page renders login methods as read-only placeholders", () => {
  const source = readFileSync(
    "src/app/dashboard/account/security/page.tsx",
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

test("dashboard shell renders breadcrumbs in the global header", () => {
  const shellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );

  assert.match(shellSource, /function DashboardHeaderBreadcrumbs/);
  assert.match(shellSource, /data-dashboard-header-breadcrumbs="true"/);
  assert.match(shellSource, /<Breadcrumb>/);
  assert.match(shellSource, /getBreadcrumbItems/);
  assert.match(shellSource, /kind: "organizationSwitcher"/);
  assert.match(shellSource, /label: "Organizacje"/);
  assert.match(shellSource, /label: "Ustawienia"/);
  assert.match(shellSource, /label: "Konto"/);
  assert.match(shellSource, /label: "Profil"/);
  assert.match(shellSource, /label: "Bezpiecze/);
  assert.match(shellSource, /label: "Nowa organizacja"/);
  assert.equal(shellSource.includes("DashboardContentHeader"), false);
  assert.equal(shellSource.includes("dashboardContentHeader"), false);
});

test("organization dropdown is only used for organization breadcrumbs", () => {
  const shellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );
  const organizationBranchStart = shellSource.indexOf("if (input.organizationId)");
  const accountBranchStart = shellSource.indexOf(
    'if (input.pathname.startsWith("/dashboard/account"))',
  );
  const newOrganizationBranchStart = shellSource.indexOf(
    "if (input.pathname === getDashboardNewOrganizationPath())",
  );
  const organizationsBranchStart = shellSource.indexOf(
    "if (input.pathname === getDashboardOrganizationsPath())",
  );
  const fallbackStart = shellSource.indexOf('label: "Panel"', organizationsBranchStart);
  const organizationBranch = shellSource.slice(
    organizationBranchStart,
    accountBranchStart,
  );
  const accountBranch = shellSource.slice(
    accountBranchStart,
    newOrganizationBranchStart,
  );
  const newOrganizationBranch = shellSource.slice(
    newOrganizationBranchStart,
    organizationsBranchStart,
  );
  const organizationsBranch = shellSource.slice(
    organizationsBranchStart,
    fallbackStart,
  );

  assert.match(organizationBranch, /kind: "organizationSwitcher"/);
  assert.equal(accountBranch.includes('kind: "organizationSwitcher"'), false);
  assert.equal(
    newOrganizationBranch.includes('kind: "organizationSwitcher"'),
    false,
  );
  assert.equal(
    organizationsBranch.includes('kind: "organizationSwitcher"'),
    false,
  );
});

test("dashboard breadcrumbs render separator as a BreadcrumbList sibling", () => {
  const shellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );
  const headerStart = shellSource.indexOf("function DashboardHeaderBreadcrumbs");
  const headerEnd = shellSource.indexOf("function OrganizationSidebar");
  const headerSource = shellSource.slice(headerStart, headerEnd);
  const itemBlocks = headerSource.match(
    /<BreadcrumbItem[\s\S]*?<\/BreadcrumbItem>/g,
  ) ?? [];

  assert.ok(itemBlocks.length > 0);
  assert.match(headerSource, /<Fragment key=/);
  assert.match(headerSource, /<\/BreadcrumbItem>\s+\{!isLast \? <BreadcrumbSeparator \/> : null\}/);
  assert.equal(
    itemBlocks.some((block) => block.includes("BreadcrumbSeparator")),
    false,
  );
});

test("account is in avatar menu and not a main header nav link", () => {
  const userMenuSource = readFileSync(
    "src/components/operator/dashboard-user-menu.tsx",
    "utf8",
  );

  assert.match(userMenuSource, /href="\/dashboard\/account\/me"/);
  assert.match(userMenuSource, /href="\/dashboard\/account\/security"/);
  assert.match(userMenuSource, /Moje konto/);
  assert.match(userMenuSource, /Bezpieczeństwo/);
  assert.match(userMenuSource, /Wyloguj/);
});

test("dashboard logo links to dashboard while public logos link home", () => {
  const dashboardShellSource = readFileSync(
    "src/components/operator/dashboard-shell.tsx",
    "utf8",
  );
  const publicRequestSource = readFileSync(
    "src/components/public/public-request-page.tsx",
    "utf8",
  );
  const publicQueueSource = readFileSync(
    "src/components/public/public-queue-page.tsx",
    "utf8",
  );

  assert.match(
    dashboardShellSource,
    /className=\{styles\.dashboardBrand\}[\s\S]*?href="\/dashboard"/,
  );
  assert.match(
    publicRequestSource,
    /className=\{styles\.brand\}[\s\S]*?href="\/"/,
  );
  assert.match(
    publicQueueSource,
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

test("public queue polling helper keeps safe refetch fallback enabled", () => {
  assert.equal(PUBLIC_QUEUE_POLL_INTERVAL_MS, 5_000);
  assert.equal(shouldPollPublicQueue(null), true);
  assert.equal(
    shouldPollPublicQueue({
      eventId: 1,
      enabled: true,
      showSongTitles: true,
      items: [],
    }),
    true,
  );
  assert.equal(
    shouldPollPublicQueue({
      eventId: 1,
      enabled: false,
      showSongTitles: true,
      items: [],
    }),
    false,
  );
});
