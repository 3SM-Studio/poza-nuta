import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAuthCallbackRedirectTo,
  getSafeDashboardAuthNextPath,
} from "../src/lib/auth-redirects.ts";
import {
  getSignupPasswordRequirementStates,
  isStrongSignupPassword,
} from "../src/lib/signup-password.ts";
import { mapSupabaseSignupError } from "../src/server/operator-api/auth-policy.ts";
import { validateSignupInput } from "../src/server/operator-api/validation.ts";

const strongPassword = "Secret123!";

test("/sign-up route, signup API and auth callback exist", () => {
  assert.equal(existsSync("src/app/sign-up/page.tsx"), true);
  assert.equal(existsSync("src/app/api/dashboard/signup/route.ts"), true);
  assert.equal(existsSync("src/app/auth/callback/route.ts"), true);
});

test("validateSignupInput accepts valid signup data and trims public fields", () => {
  assert.deepEqual(
    validateSignupInput({
      email: "  NEW@EXAMPLE.COM  ",
      password: strongPassword,
      confirmPassword: strongPassword,
      displayName: "  Nowy Operator  ",
    }),
    {
      success: true,
      data: {
        email: "new@example.com",
        password: strongPassword,
        displayName: "Nowy Operator",
      },
    },
  );
});

test("validateSignupInput rejects missing email and invalid email", () => {
  const missingEmail = validateSignupInput({
    email: "",
    password: strongPassword,
    confirmPassword: strongPassword,
    displayName: "Operator",
  });
  const invalidEmail = validateSignupInput({
    email: "not-an-email",
    password: strongPassword,
    confirmPassword: strongPassword,
    displayName: "Operator",
  });

  assert.equal(missingEmail.success, false);
  assert.deepEqual(
    missingEmail.success ? [] : missingEmail.issues.map((issue) => issue.field),
    ["email"],
  );
  assert.equal(invalidEmail.success, false);
  assert.deepEqual(
    invalidEmail.success ? [] : invalidEmail.issues.map((issue) => issue.field),
    ["email"],
  );
});

test("validateSignupInput rejects weak password and password mismatch", () => {
  const result = validateSignupInput({
    email: "new@example.com",
    password: "weakpass",
    confirmPassword: "different",
    displayName: "Operator",
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.success ? [] : result.issues.map((issue) => issue.field),
    ["password", "confirmPassword"],
  );
});

test("signup password requirements cover length, case, number and special character", () => {
  assert.equal(isStrongSignupPassword("weakpass"), false);
  assert.equal(isStrongSignupPassword(strongPassword), true);
  assert.deepEqual(
    getSignupPasswordRequirementStates("weakpass").map((item) => [
      item.id,
      item.met,
    ]),
    [
      ["minLength", true],
      ["uppercase", false],
      ["lowercase", true],
      ["number", false],
      ["special", false],
    ],
  );
});

test("validateSignupInput requires a display name within product limits", () => {
  const missingName = validateSignupInput({
    email: "new@example.com",
    password: strongPassword,
    confirmPassword: strongPassword,
    displayName: " ",
  });
  const shortName = validateSignupInput({
    email: "new@example.com",
    password: strongPassword,
    confirmPassword: strongPassword,
    displayName: "A",
  });

  assert.equal(missingName.success, false);
  assert.deepEqual(
    missingName.success ? [] : missingName.issues.map((issue) => issue.field),
    ["displayName"],
  );
  assert.equal(shortName.success, false);
  assert.deepEqual(
    shortName.success ? [] : shortName.issues.map((issue) => issue.field),
    ["displayName"],
  );
});

test("Supabase signup errors are mapped without exposing secrets", () => {
  assert.deepEqual(mapSupabaseSignupError({ code: "over_email_send_rate_limit" }), {
    status: 429,
    code: "AUTH_RATE_LIMITED",
    message: "Too many signup attempts. Try again later.",
  });
  assert.deepEqual(mapSupabaseSignupError({ status: 503 }), {
    status: 503,
    code: "AUTH_SERVICE_ERROR",
    message: "Authentication is temporarily unavailable.",
  });
  assert.deepEqual(mapSupabaseSignupError({ status: 400 }), {
    status: 400,
    code: "SIGNUP_FAILED",
    message: "The account could not be created.",
  });
});

test("signup backend calls Supabase signUp with callback redirect and display name metadata", () => {
  const routeSource = readFileSync(
    "src/app/api/dashboard/signup/route.ts",
    "utf8",
  );
  const sessionSource = readFileSync(
    "src/server/operator-api/supabase-session.ts",
    "utf8",
  );

  assert.match(routeSource, /buildAuthCallbackRedirectTo/);
  assert.match(routeSource, /emailRedirectTo: buildAuthCallbackRedirectTo/);
  assert.match(sessionSource, /supabase\.auth\.signUp\(/);
  assert.match(sessionSource, /emailRedirectTo: input\.emailRedirectTo/);
  assert.match(sessionSource, /data: \{\s*display_name: input\.data\.displayName/);
  assert.match(sessionSource, /name: input\.data\.displayName/);
  assert.match(sessionSource, /data\.user\.identities/);
  assert.match(sessionSource, /SIGNUP_FAILED/);
  assert.equal(sessionSource.includes("service_role"), false);
});

test("auth callback redirect validates next and rejects open redirects", () => {
  assert.equal(
    buildAuthCallbackRedirectTo("https://app.example.test"),
    "https://app.example.test/auth/callback?next=%2Fdashboard",
  );
  assert.equal(getSafeDashboardAuthNextPath("/dashboard"), "/dashboard");
  assert.equal(
    getSafeDashboardAuthNextPath("/dashboard/new"),
    "/dashboard/new",
  );
  assert.equal(
    getSafeDashboardAuthNextPath("https://evil.example/dashboard"),
    "/dashboard",
  );
  assert.equal(getSafeDashboardAuthNextPath("//evil.example"), "/dashboard");
  assert.equal(getSafeDashboardAuthNextPath("/queue"), "/dashboard");
});

test("auth callback exchanges code and redirects invalid links to sign-in", () => {
  const source = readFileSync("src/app/auth/callback/route.ts", "utf8");

  assert.match(source, /exchangeCodeForSession\(code\)/);
  assert.match(source, /getSafeDashboardAuthNextPath/);
  assert.match(source, /NextResponse\.redirect\(new URL\(next, requestUrl\.origin\)\)/);
  assert.match(source, /auth_error/);
  assert.match(source, /invalid_link/);
});

test("signup creates local operator but does not create workspace membership", () => {
  const source = readFileSync(
    "src/server/operator-api/supabase-session.ts",
    "utf8",
  );
  const ensureStart = source.indexOf("async function ensureSignupOperatorForAuthUser");
  const ensureEnd = source.indexOf("type DatabaseTransaction");
  const ensureSource = source.slice(ensureStart, ensureEnd);

  assert.match(ensureSource, /\.insert\(operatorUsers\)/);
  assert.match(ensureSource, /authUserId: input\.authUserId/);
  assert.match(ensureSource, /SUPABASE_AUTH_PASSWORD_HASH_PLACEHOLDER/);
  assert.equal(ensureSource.includes("workspaceMembers"), false);
});

test("signup page handles email confirmation and session redirect states", () => {
  const pageSource = readFileSync("src/app/sign-up/page.tsx", "utf8");
  const formSource = readFileSync(
    "src/components/operator/signup-form.tsx",
    "utf8",
  );

  assert.match(pageSource, /Załóż konto/);
  assert.match(pageSource, /<OperatorSignupForm \/>/);
  assert.match(formSource, /Sprawdź email/);
  assert.match(
    formSource,
    /Konto zostało utworzone\. Sprawdź skrzynkę i potwierdź adres email\./,
  );
  assert.match(formSource, /result\.status === "signed_in"/);
  assert.match(formSource, /router\.replace\("\/dashboard"\)/);
  assert.match(formSource, /Masz już konto\?/);
  assert.match(formSource, /href="\/sign-in"/);
  assert.equal(/GitHub|SSO|OAuth/.test(formSource), false);
});

test("sign-in page links to sign-up and handles auth callback errors", () => {
  const source = readFileSync("src/app/sign-in/page.tsx", "utf8");

  assert.match(source, /href="\/sign-up"/);
  assert.match(source, /Zarejestruj się/);
  assert.match(source, /auth_error/);
  assert.match(source, /Link email wygasł albo jest nieprawidłowy/);
  assert.equal(/supabase\.com\/dashboard|GitHub|SSO/.test(source), false);
});

test("new signed-up operator without organizations follows dashboard onboarding", () => {
  const dashboardRoutesSource = readFileSync(
    "src/lib/dashboard-routes.ts",
    "utf8",
  );
  const dashboardPageSource = readFileSync("src/app/dashboard/page.tsx", "utf8");

  assert.match(dashboardRoutesSource, /return "\/dashboard\/new"/);
  assert.match(dashboardPageSource, /listDashboardOrganizationsForAuthUser/);
  assert.match(dashboardPageSource, /resolveDashboardHomeRedirect/);
});
