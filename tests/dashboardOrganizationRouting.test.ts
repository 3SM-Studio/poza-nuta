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

  assert.match(source, /Create a new organization/);
  assert.match(source, /Organizations group your karaoke events/);
  assert.match(source, /Type/);
  assert.match(source, /Personal/);
  assert.match(source, /Plan/);
  assert.match(source, /Free/);
  assert.match(source, /Cancel/);
  assert.match(source, /Create organization/);
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
  assert.match(source, /Create organization/);
  assert.match(source, /Open/);
  assert.match(source, /public_id:/);
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
  const navigationSource = readFileSync(
    "src/components/operator/dashboard-navigation.tsx",
    "utf8",
  );
  const overviewSource = readFileSync(
    "src/app/dashboard/org/[organizationId]/page.tsx",
    "utf8",
  );

  assert.match(navigationSource, /getDashboardOrganizationSettingsPath/);
  assert.match(overviewSource, /getDashboardOrganizationSettingsPath/);
  assert.equal(
    navigationSource.includes("getDashboardOrganizationGeneralSettingsPath"),
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
  assert.match(dangerSource, /Danger zone/);
  assert.match(dangerSource, /confirmation === organizationId/);
  assert.match(dangerSource, /name="confirmationOrganizationId"/);
  assert.match(dangerSource, /Archive organization/);
  assert.match(dangerSource, /disabled=\{!canArchive \|\| !isConfirmed\}/);
  assert.match(dangerSource, /Events, requests and members/);
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

test("dashboard header shows organization dropdown only in org context", () => {
  const switcherSource = readFileSync(
    "src/components/operator/dashboard-organization-switcher.tsx",
    "utf8",
  );
  const navigationSource = readFileSync(
    "src/components/operator/dashboard-navigation.tsx",
    "utf8",
  );

  assert.match(switcherSource, /if \(!currentOrganizationId\) \{\s+return null;/);
  assert.match(switcherSource, /getDashboardNewOrganizationPath\(\)/);
  assert.match(switcherSource, /getDashboardOrganizationsPath\(\)/);
  assert.match(navigationSource, /isNewOrganizationRoute/);
  assert.match(navigationSource, /label: isNewOrganizationRoute \? "New organization" : "Organizations"/);
  assert.match(navigationSource, /label: "Overview"/);
  assert.match(navigationSource, /label: "Events"/);
  assert.match(navigationSource, /label: "Team"/);
  assert.match(navigationSource, /label: "Settings"/);
});

test("account is in avatar menu and not a main header nav link", () => {
  const navigationSource = readFileSync(
    "src/components/operator/dashboard-navigation.tsx",
    "utf8",
  );
  const userMenuSource = readFileSync(
    "src/components/operator/dashboard-user-menu.tsx",
    "utf8",
  );

  assert.equal(navigationSource.includes("/dashboard/account/me"), false);
  assert.equal(navigationSource.includes("Konto"), false);
  assert.match(userMenuSource, /href="\/dashboard\/account\/me"/);
  assert.match(userMenuSource, /Moje konto/);
});

test("organization dropdown links use organizationId route targets", () => {
  assert.equal(
    getDashboardOrganizationPath(exampleOrganizationId),
    `/dashboard/org/${exampleOrganizationId}`,
  );
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
