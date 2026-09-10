import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { getSupabaseAdminConfig } from "../src/lib/supabase/admin-config.ts";
import { resolveAuthConfirmPostRedirect } from "../src/lib/auth-confirm.ts";
import { resolveAuthInviteStart } from "../src/lib/auth-invite.ts";
import {
  AUTH_INVITE_COOKIE_MAX_AGE_SECONDS,
  createAuthInviteCookieValue,
  getAuthInviteCookieSecret,
  readAuthInviteCookieValue,
} from "../src/lib/auth-invite-cookie.ts";
import {
  completePlatformSetupWithStore,
  resolvePlatformBootstrapStateFromCounts,
  verifySetupTokenHash,
  type PlatformBootstrapCounts,
  type PlatformSetupStore,
  type VerifiedSetupUser,
} from "../src/server/setup/core.ts";
import {
  invitePlatformSetupUser,
  type PlatformSetupInviteAdmin,
} from "../src/server/setup/invite.ts";
import {
  validatePlatformSetupInput,
  validatePlatformSetupInviteInput,
} from "../src/server/setup/validation.ts";
import {
  consumeSetupRateLimit,
  resetSetupRateLimitForTests,
} from "../src/server/setup/rate-limit-core.ts";
import {
  getConfiguredSiteOrigin,
  requireSameOriginRequest,
} from "../src/server/setup/http.ts";
import { OperatorApiError } from "../src/server/operator-api/errors.ts";

const validToken = "setup-token-with-enough-entropy-1234567890";
const validTokenHash = createHash("sha256").update(validToken).digest("hex");
const validInviteInput = {
  setupToken: validToken,
  email: "owner@example.test",
};
const validSetupInput = {
  setupToken: validToken,
  displayName: "Ada Admin",
  workspaceName: "Poza Nuta",
  workspaceHandle: "poza-nuta",
};
const verifiedUser: VerifiedSetupUser = {
  status: "authenticated",
  id: "00000000-0000-4000-8000-000000000001",
  email: "owner@example.test",
  emailConfirmed: true,
};

test("/setup route and setup invite/finalize APIs exist", () => {
  assert.equal(existsSync("src/app/setup/page.tsx"), true);
  assert.equal(existsSync("src/app/api/setup/invite/route.ts"), true);
  assert.equal(existsSync("src/app/api/setup/finalize/route.ts"), true);
  assert.equal(existsSync("src/app/auth/invite/route.ts"), true);
  assert.equal(existsSync("src/app/auth/invite/accept/page.tsx"), true);
  assert.equal(existsSync("src/app/auth/confirm/route.ts"), true);
  assert.equal(existsSync("src/app/api/setup/signup/route.ts"), false);
});

test("setup invite input requires token and email", () => {
  assert.deepEqual(validatePlatformSetupInviteInput(validInviteInput), {
    success: true,
    data: validInviteInput,
  });
  assert.equal(
    validatePlatformSetupInviteInput({ email: "owner@example.test" }).success,
    false,
  );
  assert.equal(
    validatePlatformSetupInviteInput({ setupToken: validToken }).success,
    false,
  );
});

test("setup finalization input rejects missing token and accepts valid data", () => {
  assert.equal(
    validatePlatformSetupInput({
      ...validSetupInput,
      setupToken: "",
    }).success,
    false,
  );
  assert.deepEqual(validatePlatformSetupInput(validSetupInput), {
    success: true,
    data: validSetupInput,
  });
});

test("invalid setup token does not call inviteUserByEmail", async () => {
  const admin = new FakeInviteAdmin();

  await assert.rejects(
    () =>
      invitePlatformSetupUser(
        {
          ...validInviteInput,
          setupToken: "wrong-token-with-enough-length-123456",
        },
        {
          store: new FakeSetupStore(),
          admin,
          redirectTo: "https://app.example.test/auth/invite",
          setupTokenHash: validTokenHash,
        },
      ),
    (error) =>
      error instanceof OperatorApiError &&
      error.code === "SETUP_TOKEN_INVALID",
  );

  assert.equal(admin.invites.length, 0);
});

test("valid setup token calls inviteUserByEmail once with prefetch-safe invite redirect", async () => {
  const admin = new FakeInviteAdmin();

  await invitePlatformSetupUser(validInviteInput, {
    store: new FakeSetupStore(),
    admin,
    redirectTo: "https://app.example.test/auth/invite",
    setupTokenHash: validTokenHash,
  });

  assert.deepEqual(admin.invites, [
    {
      email: "owner@example.test",
      redirectTo: "https://app.example.test/auth/invite",
    },
  ]);
});

test("auth invite GET stores a protected short-lived cookie without verifyOtp", () => {
  withEnv({ AUTH_INVITE_COOKIE_SECRET: "x".repeat(32) }, () => {
    const invite = resolveAuthInviteStart({
      requestUrl: new URL(
        "https://app.example.test/auth/invite?token_hash=abc123&type=invite&next=https%3A%2F%2Fevil.example",
      ),
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    assert.equal(invite.status, "success");
    assert.equal(invite.location, "https://app.example.test/auth/invite/accept");

    if (invite.status !== "success") {
      throw new Error("Invite should be accepted.");
    }

    const secret = getAuthInviteCookieSecret();

    assert.ok(secret);
    assert.equal(AUTH_INVITE_COOKIE_MAX_AGE_SECONDS <= 10 * 60, true);
    assert.deepEqual(
      readAuthInviteCookieValue({
        value: invite.cookieValue,
        secret,
        now: new Date("2026-01-01T12:01:00.000Z"),
      }),
      { success: true, tokenHash: "abc123" },
    );
  });
});

test("auth invite GET rejects missing token wrong type and missing cookie secret", () => {
  for (const requestUrl of [
    "https://app.example.test/auth/invite?type=invite",
    "https://app.example.test/auth/invite?token_hash=abc123&type=email",
  ]) {
    withEnv({ AUTH_INVITE_COOKIE_SECRET: "x".repeat(32) }, () => {
      assert.deepEqual(
        resolveAuthInviteStart({ requestUrl: new URL(requestUrl) }),
        {
          status: "invalid_link",
          location: "https://app.example.test/sign-in?auth_error=invalid_link",
        },
      );
    });
  }

  withEnv({ AUTH_INVITE_COOKIE_SECRET: undefined }, () => {
    assert.deepEqual(
      resolveAuthInviteStart({
        requestUrl: new URL(
          "https://app.example.test/auth/invite?token_hash=abc123&type=invite",
        ),
      }),
      {
        status: "invalid_link",
        location: "https://app.example.test/sign-in?auth_error=invalid_link",
      },
    );
  });
});

test("tampered missing and expired invite cookies are rejected before verifyOtp", async () => {
  await withEnvAsync({ AUTH_INVITE_COOKIE_SECRET: "x".repeat(32) }, async () => {
    const secret = getAuthInviteCookieSecret();

    assert.ok(secret);

    const validCookie = createAuthInviteCookieValue({
      tokenHash: "abc123",
      secret,
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    for (const { inviteCookieValue, now } of [
      {
        inviteCookieValue: undefined,
        now: new Date("2026-01-01T12:01:00.000Z"),
      },
      {
        inviteCookieValue: `${validCookie.slice(0, -1)}a`,
        now: new Date("2026-01-01T12:01:00.000Z"),
      },
      {
        inviteCookieValue: validCookie,
        now: new Date("2026-01-01T12:11:00.000Z"),
      },
    ]) {
      const redirect = await resolveAuthConfirmPostRedirect({
        inviteCookieValue,
        requestUrl: new URL("https://app.example.test/auth/confirm"),
        now,
        verifyInviteOtp: async () => {
          throw new Error("verifyOtp should not be called.");
        },
      });

      assert.deepEqual(redirect, {
        status: "invalid_link",
        location: "https://app.example.test/sign-in?auth_error=invalid_link",
      });
    }
  });
});

test("auth confirm POST verifies invite cookie token and redirects exactly to setup", async () => {
  const calls: Array<{ token_hash: string; type: "invite" }> = [];
  await withEnvAsync({ AUTH_INVITE_COOKIE_SECRET: "x".repeat(32) }, async () => {
    const secret = getAuthInviteCookieSecret();

    assert.ok(secret);

    const redirect = await resolveAuthConfirmPostRedirect({
      inviteCookieValue: createAuthInviteCookieValue({
        tokenHash: "abc123",
        secret,
      }),
      requestUrl: new URL(
        "https://app.example.test/auth/confirm?next=https%3A%2F%2Fevil.example",
      ),
      verifyInviteOtp: async (input) => {
        calls.push(input);

        return {};
      },
    });

    assert.deepEqual(calls, [{ token_hash: "abc123", type: "invite" }]);
    assert.deepEqual(redirect, {
      status: "success",
      location: "https://app.example.test/setup",
    });
  });
});

test("auth confirm POST handles verify errors with safe redirect", async () => {
  await withEnvAsync({ AUTH_INVITE_COOKIE_SECRET: "x".repeat(32) }, async () => {
    const secret = getAuthInviteCookieSecret();

    assert.ok(secret);

    const failedVerifyRedirect = await resolveAuthConfirmPostRedirect({
      inviteCookieValue: createAuthInviteCookieValue({
        tokenHash: "abc123",
        secret,
      }),
      requestUrl: new URL("https://app.example.test/auth/confirm"),
      verifyInviteOtp: async () => ({ error: new Error("invalid") }),
    });

    assert.deepEqual(failedVerifyRedirect, {
      status: "invalid_link",
      location: "https://app.example.test/sign-in?auth_error=invalid_link",
    });
  });
});

test("initialized and inconsistent platform states block invite", async () => {
  await assert.rejects(
    () =>
      invitePlatformSetupUser(validInviteInput, {
        store: new FakeSetupStore(initializedCounts()),
        admin: new FakeInviteAdmin(),
        redirectTo: "https://app.example.test/auth/invite",
        setupTokenHash: validTokenHash,
      }),
    (error) =>
      error instanceof OperatorApiError &&
      error.code === "PLATFORM_SETUP_UNAVAILABLE",
  );

  await assert.rejects(
    () =>
      invitePlatformSetupUser(validInviteInput, {
        store: new FakeSetupStore(counts({ platformMembers: 1 })),
        admin: new FakeInviteAdmin(),
        redirectTo: "https://app.example.test/auth/invite",
        setupTokenHash: validTokenHash,
      }),
    (error) =>
      error instanceof OperatorApiError &&
      error.code === "PLATFORM_SETUP_UNAVAILABLE",
  );
});

test("SITE_URL is required for setup POST origin checks", () => {
  withEnv({ SITE_URL: undefined }, () => {
    assert.throws(
      () => getConfiguredSiteOrigin(),
      (error) =>
        error instanceof OperatorApiError &&
        error.code === "SETUP_CONFIGURATION_ERROR",
    );
  });
});

test("foreign or missing Origin is rejected for setup POST", () => {
  withEnv({ SITE_URL: "https://app.example.test" }, () => {
    assert.throws(
      () => requireSameOriginRequest(fakeRequest(null)),
      (error) =>
        error instanceof OperatorApiError && error.code === "INVALID_ORIGIN",
    );
    assert.throws(
      () => requireSameOriginRequest(fakeRequest("https://evil.example")),
      (error) =>
        error instanceof OperatorApiError && error.code === "INVALID_ORIGIN",
    );

    assert.doesNotThrow(() =>
      requireSameOriginRequest(fakeRequest("https://app.example.test")),
    );
  });
});

test("Supabase admin config prefers secret key and fails closed without keys", () => {
  assert.deepEqual(
    getSupabaseAdminConfig({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "preferred-secret",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-secret",
    }),
    {
      success: true,
      supabaseUrl: "https://project.supabase.co",
      secretKey: "preferred-secret",
    },
  );
  assert.deepEqual(
    getSupabaseAdminConfig({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: "legacy-secret",
    }),
    {
      success: true,
      supabaseUrl: "https://project.supabase.co",
      secretKey: "legacy-secret",
    },
  );
  assert.deepEqual(
    getSupabaseAdminConfig({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    }),
    { success: false },
  );
  assert.deepEqual(
    getSupabaseAdminConfig({
      SUPABASE_URL: "not-a-url",
      SUPABASE_SECRET_KEY: "secret",
    }),
    { success: false },
  );
});

test("setup token hash accepts correct token and rejects invalid config", () => {
  assert.equal(verifySetupTokenHash(validToken, validTokenHash), true);
  assert.equal(verifySetupTokenHash("wrong-token", validTokenHash), false);
  assert.equal(verifySetupTokenHash(validToken, undefined), false);
  assert.equal(verifySetupTokenHash(validToken, "not-a-sha256"), false);
});

test("bootstrap state resolver supports empty and safe legacy workspace states", () => {
  assert.equal(resolvePlatformBootstrapStateFromCounts(counts()).state, "uninitialized");
  assert.equal(
    resolvePlatformBootstrapStateFromCounts(
      counts({ workspaces: 1, legacyWorkspaceId: 7 }),
    ).state,
    "uninitialized",
  );
});

test("bootstrap state resolver classifies initialized and inconsistent states", () => {
  assert.equal(
    resolvePlatformBootstrapStateFromCounts(initializedCounts()).state,
    "initialized",
  );
  assert.equal(
    resolvePlatformBootstrapStateFromCounts(
      counts({
        platformMembers: 1,
        activePlatformOwners: 0,
      }),
    ).state,
    "inconsistent",
  );
  assert.equal(
    resolvePlatformBootstrapStateFromCounts(
      counts({
        activePlatformOwners: 0,
        workspaces: 1,
        legacyWorkspaceId: null,
      }),
    ).state,
    "inconsistent",
  );
  assert.equal(
    resolvePlatformBootstrapStateFromCounts(
      counts({
        workspaces: 1,
        legacyWorkspaceId: 7,
        events: 1,
      }),
    ).state,
    "inconsistent",
  );
  assert.equal(
    resolvePlatformBootstrapStateFromCounts(
      counts({
        activePlatformOwners: 1,
        platformMembers: 1,
        operatorUsers: 1,
        workspaces: 1,
        workspaceMembers: 0,
        completeOwnerLinks: 0,
      }),
    ).state,
    "inconsistent",
  );
});

test("bootstrap treats one or more complete bootstrap owner links as initialized", () => {
  for (const completeOwnerLinkCount of [1, 2, 3]) {
    assert.equal(
      resolvePlatformBootstrapStateFromCounts(
        counts({
          platformMembers: completeOwnerLinkCount,
          activePlatformOwners: completeOwnerLinkCount,
          operatorUsers: completeOwnerLinkCount,
          workspaces: 1,
          workspaceMembers: completeOwnerLinkCount,
          completeOwnerLinks: completeOwnerLinkCount,
        }),
      ).state,
      "initialized",
    );
  }
});

test("bootstrap uses complete bootstrap owner links instead of exact active owner membership count", () => {
  assert.equal(
    resolvePlatformBootstrapStateFromCounts(
      counts({
        platformMembers: 2,
        activePlatformOwners: 2,
        operatorUsers: 2,
        workspaces: 1,
        workspaceMembers: 1,
        completeOwnerLinks: 1,
      }),
    ).state,
    "initialized",
  );
  assert.equal(
    resolvePlatformBootstrapStateFromCounts(
      counts({
        platformMembers: 2,
        activePlatformOwners: 2,
        operatorUsers: 2,
        workspaces: 1,
        workspaceMembers: 0,
        completeOwnerLinks: 0,
      }),
    ).state,
    "inconsistent",
  );
});

test("existing platform data never reopens setup as uninitialized", () => {
  const existingPlatformStates = [
    counts({ platformMembers: 1 }),
    counts({ activePlatformOwners: 2, platformMembers: 2 }),
    counts({ operatorUsers: 1 }),
    counts({ workspaceMembers: 1, workspaces: 1 }),
    counts({ events: 1 }),
  ];

  for (const existingState of existingPlatformStates) {
    assert.notEqual(
      resolvePlatformBootstrapStateFromCounts(existingState).state,
      "uninitialized",
    );
  }
});

test("setup remains inconsistent without a complete bootstrap owner link", async () => {
  const incompleteOwnerCounts = counts({
    platformMembers: 1,
    activePlatformOwners: 1,
    operatorUsers: 1,
    workspaces: 1,
    workspaceMembers: 1,
    completeOwnerLinks: 0,
  });

  const bootstrapState = resolvePlatformBootstrapStateFromCounts(
    incompleteOwnerCounts,
  );

  assert.equal(bootstrapState.state, "inconsistent");
  assert.notEqual(bootstrapState.state, "uninitialized");

  const store = new FakeSetupStore(incompleteOwnerCounts);

  await assert.rejects(
    () =>
      completePlatformSetupWithStore(validSetupInput, {
        store,
        getVerifiedUser: async () => verifiedUser,
        setupTokenHash: validTokenHash,
      }),
    (error) =>
      error instanceof OperatorApiError &&
      error.code === "PLATFORM_SETUP_INCONSISTENT",
  );
  assert.equal(store.operators.length, 0);
  assert.equal(store.platformMembers.length, 0);
});

test("setup finalization requires a verified session and confirmed email", async () => {
  await assert.rejects(
    () =>
      completePlatformSetupWithStore(validSetupInput, {
        store: new FakeSetupStore(),
        getVerifiedUser: async () => ({ status: "missing" }),
        setupTokenHash: validTokenHash,
      }),
    (error) =>
      error instanceof OperatorApiError &&
      error.status === 401 &&
      error.code === "AUTHENTICATION_REQUIRED",
  );
  await assert.rejects(
    () =>
      completePlatformSetupWithStore(validSetupInput, {
        store: new FakeSetupStore(),
        getVerifiedUser: async () => ({
          ...verifiedUser,
          emailConfirmed: false,
        }),
        setupTokenHash: validTokenHash,
      }),
    (error) =>
      error instanceof OperatorApiError &&
      error.status === 403 &&
      error.code === "EMAIL_CONFIRMATION_REQUIRED",
  );
});

test("session from invite can finalize local platform setup", async () => {
  const store = new FakeSetupStore();
  const result = await completePlatformSetupWithStore(validSetupInput, {
    store,
    getVerifiedUser: async () => verifiedUser,
    setupTokenHash: validTokenHash,
  });

  assert.deepEqual(result, {
    operatorUserId: 1,
    workspaceId: 1,
  });
  assert.equal(store.operators[0]?.authUserId, verifiedUser.id);
  assert.equal(store.platformMembers[0]?.role, "platform_owner");
  assert.equal(store.events.length, 0);
});

test("legacy workspace is reused and updated without creating a second workspace", async () => {
  const store = new FakeSetupStore(
    counts({ workspaces: 1, legacyWorkspaceId: 7 }),
    [{ id: 7, name: "Poza Nuta", handle: "pozanuta" }],
  );

  await completePlatformSetupWithStore(validSetupInput, {
    store,
    getVerifiedUser: async () => verifiedUser,
    setupTokenHash: validTokenHash,
  });

  assert.equal(store.workspaces.length, 1);
  assert.deepEqual(store.workspaces[0], {
    id: 7,
    name: "Poza Nuta",
    handle: "poza-nuta",
  });
});

test("second setup and parallel setup attempts cannot create two owners", async () => {
  const store = new FakeSetupStore();

  await completePlatformSetupWithStore(validSetupInput, {
    store,
    getVerifiedUser: async () => verifiedUser,
    setupTokenHash: validTokenHash,
  });
  await assert.rejects(
    () =>
      completePlatformSetupWithStore(validSetupInput, {
        store,
        getVerifiedUser: async () => verifiedUser,
        setupTokenHash: validTokenHash,
      }),
    (error) =>
      error instanceof OperatorApiError &&
      error.code === "PLATFORM_ALREADY_INITIALIZED",
  );

  const parallelStore = new FakeSetupStore();
  const [first, second] = await Promise.allSettled([
    completePlatformSetupWithStore(validSetupInput, {
      store: parallelStore,
      getVerifiedUser: async () => verifiedUser,
      setupTokenHash: validTokenHash,
    }),
    completePlatformSetupWithStore(validSetupInput, {
      store: parallelStore,
      getVerifiedUser: async () => verifiedUser,
      setupTokenHash: validTokenHash,
    }),
  ]);

  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  assert.equal(parallelStore.platformMembers.length, 1);
});

test("setup transaction path uses Drizzle transaction and advisory lock", () => {
  const source = readFileSync("src/server/setup/service.ts", "utf8");

  assert.match(source, /getDb\(\)\.transaction/);
  assert.match(source, /pg_advisory_xact_lock/);
});

test("setup token and service role do not appear in URL storage metadata or client code", () => {
  const inviteRouteSource = readFileSync(
    "src/app/api/setup/invite/route.ts",
    "utf8",
  );
  const finalizeRouteSource = readFileSync(
    "src/app/api/setup/finalize/route.ts",
    "utf8",
  );
  const formSource = readFileSync(
    "src/components/operator/setup-forms.tsx",
    "utf8",
  );

  assert.equal(/searchParams.*setupToken/.test(inviteRouteSource), false);
  assert.equal(/searchParams.*setupToken/.test(finalizeRouteSource), false);
  assert.equal(
    /localStorage|sessionStorage|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/.test(
      formSource,
    ),
    false,
  );
  assert.equal(/AUTH_INVITE_COOKIE_SECRET/.test(formSource), false);
  assert.equal(/user_metadata|data:\s*\{/.test(inviteRouteSource), false);
  assert.doesNotMatch(inviteRouteSource, /auth\.signUp\(/);
  assert.match(inviteRouteSource, /inviteUserByEmail/);
  assert.match(formSource, /auth\.updateUser\(\{\s*password/s);
  assert.doesNotMatch(finalizeRouteSource, /password/);
});

test("auth confirm route uses verifyOtp invite without logging token hash", () => {
  const routeSource = readFileSync("src/app/auth/confirm/route.ts", "utf8");
  const helperSource = readFileSync("src/lib/auth-confirm.ts", "utf8");
  const inviteRouteSource = readFileSync("src/app/auth/invite/route.ts", "utf8");
  const acceptPageSource = readFileSync(
    "src/app/auth/invite/accept/page.tsx",
    "utf8",
  );

  assert.match(routeSource, /export async function POST/);
  assert.doesNotMatch(routeSource, /export async function GET/);
  assert.match(routeSource, /requireSameOriginRequest/);
  assert.match(routeSource, /status:\s*303/);
  assert.doesNotMatch(inviteRouteSource, /verifyOtp/);
  assert.doesNotMatch(acceptPageSource, /verifyOtp|token_hash|searchParams/);
  assert.match(routeSource, /auth\.verifyOtp/);
  assert.match(helperSource, /type: "invite"/);
  assert.match(routeSource, /maxAge:\s*0/);
  assert.doesNotMatch(`${routeSource}\n${helperSource}\n${inviteRouteSource}`, /console\./);
  assert.doesNotMatch(`${routeSource}\n${helperSource}`, /searchParams\.get\("next"\)/);
});

test("deployment docs specify invite template without setup token", () => {
  const docsSource = readFileSync("docs/DEPLOYMENT.md", "utf8");

  assert.match(
    docsSource,
    /\{\{ \.SiteURL \}\}\/auth\/invite\?token_hash=\{\{ \.TokenHash \}\}&type=invite/,
  );
  assert.doesNotMatch(docsSource, /setupToken=.*TokenHash/);
  assert.match(docsSource, /Disable email link tracking/);
});

test("platform setup migration preserves platform_member_role history", () => {
  const schemaSource = readFileSync("src/db/schema.ts", "utf8");
  const migrationSource = readFileSync(
    "drizzle/0011_platform_initial_setup.sql",
    "utf8",
  );

  assert.match(schemaSource, /platformMemberRoleValues = \[/);
  assert.match(schemaSource, /"platform_owner"/);
  assert.match(schemaSource, /"platform_admin"/);
  assert.match(schemaSource, /"support"/);
  assert.match(
    schemaSource,
    /platformMemberRoleEnum = pgEnum\([\s\S]*"platform_member_role"/,
  );
  assert.doesNotMatch(schemaSource, /pgEnum\("platform_role"/);
  assert.doesNotMatch(migrationSource, /CREATE TYPE/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE "platform_members" ALTER COLUMN "role"/);
  assert.match(migrationSource, /platform_members_one_active_owner_idx/);
  assert.match(migrationSource, /role" = 'platform_owner'/);
  assert.match(migrationSource, /active" = true/);
});

test("setup rate limiting remains defense in depth", () => {
  resetSetupRateLimitForTests();

  for (let index = 0; index < 5; index += 1) {
    assert.equal(
      consumeSetupRateLimit({
        scope: "setup-token",
        key: "test",
        now: 1_000,
      }).allowed,
      true,
    );
  }

  assert.equal(
    consumeSetupRateLimit({
      scope: "setup-token",
      key: "test",
      now: 1_000,
    }).allowed,
    false,
  );
});

function counts(
  overrides: Partial<PlatformBootstrapCounts> = {},
): PlatformBootstrapCounts {
  return {
    platformMembers: 0,
    activePlatformOwners: 0,
    operatorUsers: 0,
    workspaces: 0,
    workspaceMembers: 0,
    completeOwnerLinks: 0,
    events: 0,
    legacyWorkspaceId: null,
    ...overrides,
  };
}

function initializedCounts() {
  return counts({
    platformMembers: 1,
    activePlatformOwners: 1,
    operatorUsers: 1,
    workspaces: 1,
    workspaceMembers: 1,
    completeOwnerLinks: 1,
  });
}

function fakeRequest(origin: string | null) {
  return {
    headers: {
      get(name: string) {
        return name.toLowerCase() === "origin" ? origin : null;
      },
    },
  } as never;
}

function withEnv(overrides: Record<string, string | undefined>, callback: () => void) {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withEnvAsync<T>(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<T>,
) {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

class FakeInviteAdmin implements PlatformSetupInviteAdmin {
  readonly invites: Array<{ email: string; redirectTo: string }> = [];

  async inviteUserByEmail(email: string, options: { redirectTo: string }) {
    this.invites.push({ email, redirectTo: options.redirectTo });

    return { error: null };
  }
}

class FakeSetupStore implements PlatformSetupStore {
  readonly operators: Array<{ id: number; authUserId: string }> = [];
  readonly platformMembers: Array<{
    operatorUserId: number;
    role: "platform_owner";
    active: boolean;
  }> = [];
  readonly workspaces: Array<{ id: number; name: string; handle: string }> = [];
  readonly workspaceMembers: Array<{
    workspaceId: number;
    operatorUserId: number;
  }> = [];
  readonly events: Array<{ id: number }> = [];

  private lockTail: Promise<void> = Promise.resolve();
  private releaseLock: (() => void) | null = null;
  private initialCounts: PlatformBootstrapCounts;
  private wroteLocalData = false;

  constructor(
    initialCounts: PlatformBootstrapCounts = counts(),
    workspaces: Array<{ id: number; name: string; handle: string }> = [],
  ) {
    this.initialCounts = initialCounts;
    this.workspaces.push(...workspaces);
  }

  async acquireSetupLock() {
    const previous = this.lockTail;
    let release!: () => void;
    this.lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.releaseLock = release;
  }

  async getBootstrapCounts() {
    if (!this.wroteLocalData) {
      return this.initialCounts;
    }

    return counts({
      platformMembers: this.platformMembers.length,
      activePlatformOwners: this.platformMembers.filter(
        (member) => member.role === "platform_owner" && member.active,
      ).length,
      operatorUsers: this.operators.length,
      workspaces: this.workspaces.length,
      workspaceMembers: this.workspaceMembers.length,
      completeOwnerLinks:
        this.platformMembers.length > 0 && this.workspaceMembers.length > 0
          ? 1
          : 0,
      events: this.events.length,
    });
  }

  async createOperator(input: { authUserId: string }) {
    this.wroteLocalData = true;
    const operator = {
      id: this.operators.length + 1,
      authUserId: input.authUserId,
    };
    this.operators.push(operator);

    return operator;
  }

  async createPlatformOwner(input: { operatorUserId: number }) {
    if (
      this.platformMembers.some(
        (member) => member.role === "platform_owner" && member.active,
      )
    ) {
      throw new OperatorApiError(
        409,
        "PLATFORM_ALREADY_INITIALIZED",
        "Platform setup is already complete.",
      );
    }

    this.platformMembers.push({
      operatorUserId: input.operatorUserId,
      role: "platform_owner",
      active: true,
    });
  }

  async createWorkspace(input: {
    handle: string;
    name: string;
    legacyWorkspaceId: number | null;
  }) {
    if (input.legacyWorkspaceId !== null) {
      const workspace = this.workspaces.find(
        (candidate) => candidate.id === input.legacyWorkspaceId,
      );

      if (!workspace) {
        throw new Error("Workspace could not be updated.");
      }

      workspace.name = input.name;
      workspace.handle = input.handle;

      return { id: workspace.id };
    }

    const workspace = {
      id: this.workspaces.length + 1,
      name: input.name,
      handle: input.handle,
    };
    this.workspaces.push(workspace);

    return workspace;
  }

  async createWorkspaceOwner(input: {
    workspaceId: number;
    operatorUserId: number;
  }) {
    this.workspaceMembers.push(input);
  }

  async countEvents() {
    this.releaseLock?.();
    this.releaseLock = null;

    return this.events.length;
  }
}
