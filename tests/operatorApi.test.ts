import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hashPin, verifyPin } from "../src/server/operator-api/crypto.ts";
import {
  mapSupabaseLoginError,
  resolveOperatorAccess,
  resolveSignInPageAccess,
} from "../src/server/operator-api/auth-policy.ts";
import {
  validateLoginInput,
  validateRequestId,
} from "../src/server/operator-api/validation.ts";

test("hashPin and verifyPin accept only the original PIN", async () => {
  const encodedHash = await hashPin("4826");

  assert.notEqual(encodedHash, "4826");
  assert.equal(await verifyPin("4826", encodedHash), true);
  assert.equal(await verifyPin("4827", encodedHash), false);
  assert.equal(await verifyPin("4826", "not-a-valid-hash"), false);
});

test("validateLoginInput normalizes email but preserves password exactly", () => {
  assert.deepEqual(
    validateLoginInput({
      email: "  OPERATOR@example.com  ",
      password: " secret password ",
    }),
    {
      success: true,
      data: {
        email: "operator@example.com",
        password: " secret password ",
      },
    },
  );
});

test("validateLoginInput rejects malformed email and short password", () => {
  const result = validateLoginInput({
    email: "not-an-email",
    password: "123",
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.success ? [] : result.issues.map((issue) => issue.field),
    ["email", "password"],
  );
});

test("Supabase login errors are mapped to safe API errors", () => {
  assert.deepEqual(mapSupabaseLoginError({ code: "invalid_credentials" }), {
    status: 401,
    code: "INVALID_CREDENTIALS",
    message: "The email address or password is incorrect.",
  });
  assert.equal(
    mapSupabaseLoginError({ code: "over_request_rate_limit" }).status,
    429,
  );
  assert.deepEqual(mapSupabaseLoginError({ status: 503 }), {
    status: 503,
    code: "AUTH_SERVICE_ERROR",
    message: "Authentication is temporarily unavailable.",
  });
});

test("Supabase Auth users must map to an active local operator", () => {
  const unauthenticated = resolveOperatorAccess(null, null);
  const unlinked = resolveOperatorAccess(
    "62e01318-1043-48a1-93de-d3f0469545c6",
    null,
  );

  assert.equal(unauthenticated.allowed, false);
  assert.equal(unauthenticated.allowed ? null : unauthenticated.status, 401);
  assert.equal(
    unauthenticated.allowed ? null : unauthenticated.code,
    "AUTHENTICATION_REQUIRED",
  );
  assert.equal(unlinked.allowed, false);
  assert.equal(unlinked.allowed ? null : unlinked.status, 403);
  assert.deepEqual(
    resolveOperatorAccess("62e01318-1043-48a1-93de-d3f0469545c6", {
      id: 7,
      name: "Operator",
      displayName: null,
      profileCompletedAt: null,
      active: false,
      suspendedAt: null,
    }),
    {
      allowed: false,
      status: 403,
      code: "OPERATOR_INACTIVE",
      message: "This operator account is inactive.",
    },
  );
  assert.deepEqual(
    resolveOperatorAccess("62e01318-1043-48a1-93de-d3f0469545c6", {
      id: 7,
      name: "Operator",
      displayName: null,
      profileCompletedAt: null,
      active: true,
      suspendedAt: null,
    }),
    {
      allowed: true,
      operator: {
        id: 7,
        name: "Operator",
        displayName: null,
        profileCompletedAt: null,
        active: true,
      },
    },
  );
});

test("operator API maps infrastructure timeout to controlled 503", () => {
  const source = readFileSync(
    new URL("../src/server/operator-api/responses.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /isTransientInfrastructureError/);
  assert.match(source, /SERVICE_UNAVAILABLE/);
  assert.match(source, /503/);
});

test("operator session lookup is memoized without routeName as cache key", () => {
  const source = readFileSync(
    new URL("../src/server/operator-api/supabase-session.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /import \{ cache \} from "react"/);
  assert.match(source, /const getCachedOperatorSession = cache\(/);
  assert.match(source, /getCachedOperatorSession\(\)/);
  assert.match(source, /traceServerStepWithoutTimeout\(routeName, "getSession"/);
  assert.match(source, /SESSION_DB_STEP_TIMEOUT_MS = 4_000/);
  assert.match(source, /"findLinkedOperator"[\s\S]*SESSION_DB_STEP_TIMEOUT_MS/);
  assert.equal(source.includes("getCachedOperatorSession(routeName"), false);
});

test("operator session hot path verifies cached JWT claims without a remote getUser call", () => {
  const source = readFileSync(
    new URL("../src/server/operator-api/supabase-session.ts", import.meta.url),
    "utf8",
  );
  const sessionStart = source.indexOf("async function resolveOperatorSession");
  const logoutStart = source.indexOf("export async function logoutOperator");
  const sessionSource = source.slice(sessionStart, logoutStart);

  assert.match(sessionSource, /getVerifiedAuthIdentity/);
  assert.match(sessionSource, /supabase\.auth\.getClaims\(\)/);
  assert.doesNotMatch(sessionSource, /supabase\.auth\.getUser\(\)/);
});

test("operator login performs one full navigation after the session cookie is written", () => {
  const source = readFileSync(
    new URL("../src/components/operator/login-form.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /window\.location\.replace\("\/dashboard"\)/);
  assert.doesNotMatch(source, /useRouter|router\.replace|router\.refresh/);
});

test("dashboard organization list is memoized per request render", () => {
  const source = readFileSync(
    new URL("../src/server/operator-api/organizations.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /import \{ cache \} from "react"/);
  assert.match(source, /export const listDashboardOrganizationsForAuthUser = cache\(/);
  assert.match(source, /async \(authUserId: string\)/);
});

test("operator API preserves auth and permission errors before infra fallback", () => {
  const source = readFileSync(
    new URL("../src/server/operator-api/responses.ts", import.meta.url),
    "utf8",
  );
  const operatorErrorBranch = source.indexOf("error instanceof OperatorApiError");
  const infrastructureBranch = source.indexOf(
    "if (isTransientInfrastructureError(error))",
  );

  assert.ok(operatorErrorBranch >= 0);
  assert.ok(infrastructureBranch >= 0);
  assert.ok(operatorErrorBranch < infrastructureBranch);
  assert.match(source, /error\.status/);
  assert.match(source, /code: error\.code/);
});

test("dashboard me route keeps session failures on the operator API response path", () => {
  const source = readFileSync(
    new URL("../src/app/api/dashboard/me/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /requireOperatorSession\("dashboard\.me"\)/);
  assert.match(source, /operatorApiErrorResponse\(error\)/);
});

test("sign-in page distinguishes guests, authorized operators and denied users", () => {
  assert.deepEqual(resolveSignInPageAccess(null, null), {
    state: "guest",
  });
  assert.deepEqual(
    resolveSignInPageAccess(
      "62e01318-1043-48a1-93de-d3f0469545c6",
      null,
    ),
    {
      state: "unauthorized",
      code: "OPERATOR_NOT_LINKED",
    },
  );
  assert.deepEqual(
    resolveSignInPageAccess("62e01318-1043-48a1-93de-d3f0469545c6", {
      id: 7,
      name: "Operator",
      displayName: null,
      profileCompletedAt: null,
      active: false,
      suspendedAt: null,
    }),
    {
      state: "unauthorized",
      code: "OPERATOR_INACTIVE",
    },
  );
  assert.deepEqual(
    resolveSignInPageAccess("62e01318-1043-48a1-93de-d3f0469545c6", {
      id: 7,
      name: "Operator",
      displayName: null,
      profileCompletedAt: null,
      active: true,
      suspendedAt: null,
    }),
    {
      state: "authorized",
      operator: {
        id: 7,
        name: "Operator",
        displayName: null,
        profileCompletedAt: null,
        active: true,
      },
    },
  );
});

test("validateRequestId accepts only safe positive integer path values", () => {
  assert.deepEqual(validateRequestId("42"), {
    success: true,
    data: 42,
  });
  assert.equal(validateRequestId("0").success, false);
  assert.equal(validateRequestId("1.5").success, false);
  assert.equal(validateRequestId("abc").success, false);
});
