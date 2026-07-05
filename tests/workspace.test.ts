import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildWorkspaceHandleFromName,
  validateOrganizationName,
} from "../src/lib/organization-workspace.ts";
import {
  DEFAULT_WORKSPACE_HANDLE,
  DEFAULT_WORKSPACE_NAME,
  isDefaultWorkspaceHandle,
} from "../src/lib/workspace.ts";
import {
  DEFAULT_WORKSPACE_MEMBER_ROLE,
  formatWorkspaceMemberLinkSummary,
  resolveWorkspaceMemberLinkOptions,
} from "../src/db/workspace-member-linking.ts";

test("default workspace identity uses the public Poza Nuta handle", () => {
  assert.equal(DEFAULT_WORKSPACE_NAME, "Poza Nutą");
  assert.equal(DEFAULT_WORKSPACE_HANDLE, "pozanuta");
  assert.equal(isDefaultWorkspaceHandle("pozanuta"), true);
  assert.equal(isDefaultWorkspaceHandle("other-workspace"), false);
});

test("workspace member linking uses safe bootstrap defaults", () => {
  assert.deepEqual(resolveWorkspaceMemberLinkOptions({}), {
    workspaceHandle: "pozanuta",
    role: "owner",
  });
  assert.equal(DEFAULT_WORKSPACE_MEMBER_ROLE, "owner");
});

test("workspace member linking accepts explicit handle and role", () => {
  assert.deepEqual(
    resolveWorkspaceMemberLinkOptions({
      WORKSPACE_HANDLE: "demo-room",
      WORKSPACE_MEMBER_ROLE: "manager",
    }),
    {
      workspaceHandle: "demo-room",
      role: "manager",
    },
  );
});

test("workspace member linking rejects invalid role", () => {
  assert.throws(
    () =>
      resolveWorkspaceMemberLinkOptions({
        WORKSPACE_MEMBER_ROLE: "admin",
      }),
    /WORKSPACE_MEMBER_ROLE/,
  );
});

test("workspace member link summary does not include secrets", () => {
  const summary = formatWorkspaceMemberLinkSummary({
    workspaceHandle: "pozanuta",
    workspaceExists: true,
    operatorExists: true,
    membershipStatus: "created",
    role: "owner",
  });

  assert.equal(summary.includes("DATABASE_URL"), false);
  assert.equal(summary.includes("OPERATOR_AUTH_USER_ID"), false);
  assert.equal(summary.includes("secret"), false);
  assert.match(summary, /workspace handle: pozanuta/);
  assert.match(summary, /membership: created/);
});

test("organization names normalize to internal workspace handles", () => {
  assert.equal(buildWorkspaceHandleFromName("  Poza Nutą  "), "poza-nuta");
  assert.equal(buildWorkspaceHandleFromName("!!!"), "pozanuta");
  assert.deepEqual(validateOrganizationName("  Demo   Club  "), {
    success: true,
    name: "Demo Club",
  });
});

test("seed provides publicId for new workspace but does not overwrite existing publicId", () => {
  const seedSource = readFileSync("src/db/seed.ts", "utf8");
  const conflictUpdateStart = seedSource.indexOf(".onConflictDoUpdate");
  const returningStart = seedSource.indexOf(".returning", conflictUpdateStart);
  const conflictUpdateSource = seedSource.slice(
    conflictUpdateStart,
    returningStart,
  );

  assert.match(seedSource, /publicId: await generateUniqueWorkspacePublicId/);
  assert.equal(conflictUpdateSource.includes("publicId"), false);
});
