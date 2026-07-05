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
  getDashboardOrganizationEventsPath,
  getDashboardOrganizationGeneralSettingsPath,
  getDashboardOrganizationPath,
  getDashboardOrganizationSettingsPath,
  getDashboardOrganizationTeamPath,
} from "../src/lib/dashboard-routes.ts";
import { sanitizeAuthIdentities } from "../src/server/operator-api/account.ts";
import {
  PUBLIC_QUEUE_POLL_INTERVAL_MS,
  shouldPollPublicQueue,
} from "../src/components/public/public-queue-polling.ts";

const exampleOrganizationId = "kgbgnpwpbcaebdytjmbx";

test("organization public IDs use twenty lowercase alphanumeric characters", () => {
  const publicId = generateOrganizationPublicId();

  assert.equal(publicId.length, 20);
  assert.equal(isOrganizationPublicId(publicId), true);
  assert.equal(isOrganizationPublicId("pozanuta"), false);
  assert.equal(isOrganizationPublicId("KGBGNPWPBCAEBDYTJMBX"), false);
});

test("organization route helpers encode organizationId values", () => {
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
  const source = readFileSync(
    "src/components/operator/dashboard-organization-switcher.tsx",
    "utf8",
  );

  assert.match(source, /if \(!currentOrganizationId\) \{\s+return null;/);
  assert.match(source, /href="\/dashboard\/organizations\/new"/);
  assert.match(source, /href="\/dashboard\/organizations"/);
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
