import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  AuthRedirectConfigurationError,
  buildAuthCallbackRedirectTo,
  getAuthRedirectOrigin,
  getSafeDashboardAuthNextPath,
} from "../src/lib/auth-redirects.ts";
import { resolveAuthCallbackRedirect } from "../src/lib/auth-callback.ts";
import {
  getSignupPasswordRequirementStates,
  isStrongSignupPassword,
} from "../src/lib/signup-password.ts";
import { mapSupabaseSignupError } from "../src/server/operator-api/auth-policy.ts";
import {
  validateOperatorProfileInput,
  validateSignupInput,
} from "../src/server/operator-api/validation.ts";

const strongPassword = "Secret123!";

test("/sign-up route, signup API, auth callback and profile onboarding exist", () => {
  assert.equal(existsSync("src/app/sign-up/page.tsx"), true);
  assert.equal(existsSync("src/app/api/dashboard/signup/route.ts"), true);
  assert.equal(existsSync("src/app/auth/callback/route.ts"), true);
  assert.equal(existsSync("src/app/dashboard/onboarding/profile/page.tsx"), true);
});

test("validateSignupInput accepts valid signup data without profile fields", () => {
  assert.deepEqual(
    validateSignupInput({
      email: "  NEW@EXAMPLE.COM  ",
      password: strongPassword,
      confirmPassword: strongPassword,
    }),
    {
      success: true,
      data: {
        email: "new@example.com",
        password: strongPassword,
      },
    },
  );
});

test("validateSignupInput rejects missing email and invalid email", () => {
  const missingEmail = validateSignupInput({
    email: "",
    password: strongPassword,
    confirmPassword: strongPassword,
  });
  const invalidEmail = validateSignupInput({
    email: "not-an-email",
    password: strongPassword,
    confirmPassword: strongPassword,
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

test("validateSignupInput ignores displayName and profile validation is separate", () => {
  const signup = validateSignupInput({
    email: "new@example.com",
    password: strongPassword,
    confirmPassword: strongPassword,
    displayName: " ",
  });
  const missingName = validateOperatorProfileInput({ displayName: " " });
  const shortName = validateOperatorProfileInput({ displayName: "A" });
  const validName = validateOperatorProfileInput({
    displayName: "  Jan Kowalski  ",
  });

  assert.deepEqual(signup, {
    success: true,
    data: {
      email: "new@example.com",
      password: strongPassword,
    },
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
  assert.deepEqual(validName, {
    success: true,
    data: { displayName: "Jan Kowalski" },
  });
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

test("signup backend calls Supabase signUp with callback redirect and no profile metadata", () => {
  const routeSource = readFileSync(
    "src/app/api/dashboard/signup/route.ts",
    "utf8",
  );
  const sessionSource = readFileSync(
    "src/server/operator-api/supabase-session.ts",
    "utf8",
  );

  assert.match(routeSource, /buildAuthCallbackRedirectTo/);
  assert.match(routeSource, /getAuthRedirectOrigin/);
  assert.match(routeSource, /emailRedirectTo: buildAuthCallbackRedirectTo/);
  assert.match(sessionSource, /supabase\.auth\.signUp\(/);
  assert.match(sessionSource, /emailRedirectTo: input\.emailRedirectTo/);
  assert.equal(sessionSource.includes("input.data.displayName"), false);
  assert.equal(/display_name:\s*input\.data/.test(sessionSource), false);
  assert.equal(/name:\s*input\.data/.test(sessionSource), false);
  assert.match(sessionSource, /data\.user\.identities/);
  assert.match(sessionSource, /SIGNUP_FAILED/);
  assert.equal(sessionSource.includes("service_role"), false);
});

test("auth callback redirect validates next and rejects open redirects", () => {
  assert.equal(
    buildAuthCallbackRedirectTo("https://app.example.test"),
    "https://app.example.test/auth/callback?next=%2Fdashboard",
  );

  const cases: Array<{
    name: string;
    input: string;
    expected: string;
  }> = [
    {
      name: "protocol-relative URL",
      input: "//evil.example",
      expected: "/dashboard",
    },
    {
      name: "backslash host confusion",
      input: "/\\evil.example",
      expected: "/dashboard",
    },
    {
      name: "encoded protocol slashes",
      input: "https:%2F%2Fevil.example",
      expected: "/dashboard",
    },
    {
      name: "encoded protocol-relative path",
      input: "%2F%2Fevil.example",
      expected: "/dashboard",
    },
    {
      name: "javascript URL",
      input: "javascript:alert(1)",
      expected: "/dashboard",
    },
    {
      name: "empty value",
      input: "",
      expected: "/dashboard",
    },
    {
      name: "path without leading slash",
      input: "dashboard",
      expected: "/dashboard",
    },
    {
      name: "dashboard root",
      input: "/dashboard",
      expected: "/dashboard",
    },
    {
      name: "dashboard queue with query",
      input: "/dashboard/queue?event=123",
      expected: "/dashboard/queue?event=123",
    },
    {
      name: "platform setup",
      input: "/setup",
      expected: "/setup",
    },
  ];

  for (const { name, input, expected } of cases) {
    assert.equal(getSafeDashboardAuthNextPath(input), expected, name);
  }
});

test("auth callback exchanges a valid code and redirects to dashboard", async () => {
  let exchangedCode: string | null = null;

  const redirect = await resolveAuthCallbackRedirect({
    requestUrl: new URL("https://app.example.test/auth/callback?code=valid-code"),
    exchangeCodeForSession: async (code) => {
      exchangedCode = code;

      return {};
    },
  });

  assert.equal(exchangedCode, "valid-code");
  assert.deepEqual(redirect, {
    status: "success",
    location: "https://app.example.test/dashboard",
  });
});

test("auth callback redirects missing code to sign-in without exchange", async () => {
  let exchangeCalled = false;

  const redirect = await resolveAuthCallbackRedirect({
    requestUrl: new URL("https://app.example.test/auth/callback"),
    exchangeCodeForSession: async () => {
      exchangeCalled = true;

      return {};
    },
  });

  assert.equal(exchangeCalled, false);
  assert.deepEqual(redirect, {
    status: "invalid_link",
    location: "https://app.example.test/sign-in?auth_error=invalid_link",
  });
});

test("auth callback redirects exchange errors to sign-in", async () => {
  const redirect = await resolveAuthCallbackRedirect({
    requestUrl: new URL("https://app.example.test/auth/callback?code=expired"),
    exchangeCodeForSession: async () => ({
      error: new Error("expired"),
    }),
  });

  assert.deepEqual(redirect, {
    status: "invalid_link",
    location: "https://app.example.test/sign-in?auth_error=invalid_link",
  });
});

test("auth callback accepts safe local next paths", async () => {
  const redirect = await resolveAuthCallbackRedirect({
    requestUrl: new URL(
      "https://app.example.test/auth/callback?code=valid-code&next=%2Fdashboard%2Fnew",
    ),
    exchangeCodeForSession: async () => ({}),
  });

  assert.deepEqual(redirect, {
    status: "success",
    location: "https://app.example.test/dashboard/new",
  });
});

test("auth callback accepts setup next path", async () => {
  const redirect = await resolveAuthCallbackRedirect({
    requestUrl: new URL(
      "https://app.example.test/auth/callback?code=valid-code&next=%2Fsetup",
    ),
    exchangeCodeForSession: async () => ({}),
  });

  assert.deepEqual(redirect, {
    status: "success",
    location: "https://app.example.test/setup",
  });
});

test("auth callback rejects open redirect attempts in next", async () => {
  const redirect = await resolveAuthCallbackRedirect({
    requestUrl: new URL(
      "https://app.example.test/auth/callback?code=valid-code&next=https%3A%2F%2Fevil.example",
    ),
    exchangeCodeForSession: async () => ({}),
  });

  assert.deepEqual(redirect, {
    status: "success",
    location: "https://app.example.test/dashboard",
  });
});

test("signup emailRedirectTo uses the configured server-only app origin", (t) => {
  const originalSiteUrl = process.env.SITE_URL;

  t.after(() => {
    restoreEnv("SITE_URL", originalSiteUrl);
  });

  process.env.SITE_URL = "https://poza-nuta.vercel.app/some/path";

  assert.equal(
    buildAuthCallbackRedirectTo(getAuthRedirectOrigin("http://localhost:3000")),
    "https://poza-nuta.vercel.app/auth/callback?next=%2Fdashboard",
  );
});

test("signup emailRedirectTo falls back to request origin when SITE_URL is missing or empty", (t) => {
  const originalSiteUrl = process.env.SITE_URL;

  t.after(() => {
    restoreEnv("SITE_URL", originalSiteUrl);
  });

  delete process.env.SITE_URL;

  assert.equal(
    buildAuthCallbackRedirectTo(getAuthRedirectOrigin("http://localhost:3000")),
    "http://localhost:3000/auth/callback?next=%2Fdashboard",
  );

  process.env.SITE_URL = "   ";

  assert.equal(
    buildAuthCallbackRedirectTo(getAuthRedirectOrigin("http://localhost:3000")),
    "http://localhost:3000/auth/callback?next=%2Fdashboard",
  );
});

test("signup emailRedirectTo rejects invalid configured SITE_URL without exposing it", (t) => {
  const originalSiteUrl = process.env.SITE_URL;

  t.after(() => {
    restoreEnv("SITE_URL", originalSiteUrl);
  });

  process.env.SITE_URL = "not-a-url";

  assert.throws(
    () => getAuthRedirectOrigin("http://localhost:3000"),
    (error) =>
      error instanceof AuthRedirectConfigurationError &&
      error.message === "Authentication redirect configuration is invalid." &&
      !error.message.includes("not-a-url"),
  );
});

test("auth callback route is wired to server-side code exchange", () => {
  const source = readFileSync("src/app/auth/callback/route.ts", "utf8");

  assert.match(source, /exchangeCodeForSession\(code\)/);
  assert.match(source, /resolveAuthCallbackRedirect/);
  assert.match(source, /createSupabaseServerClient/);
  assert.match(source, /NextResponse\.redirect\(redirect\.location\)/);
});

test("signup creates local operator with empty profile and without workspace membership", () => {
  const source = readFileSync(
    "src/server/operator-api/supabase-session.ts",
    "utf8",
  );
  const ensureStart = source.indexOf("async function ensureSignupOperatorForAuthUser");
  const ensureEnd = source.indexOf("export async function updateOperatorProfileForAuthUser");
  const ensureSource = source.slice(ensureStart, ensureEnd);

  assert.match(ensureSource, /\.insert\(operatorUsers\)/);
  assert.match(ensureSource, /authUserId: input\.authUserId/);
  assert.match(ensureSource, /displayName: null/);
  assert.match(ensureSource, /profileCompletedAt: null/);
  assert.match(ensureSource, /SIGNUP_OPERATOR_NAME_PLACEHOLDER/);
  assert.match(ensureSource, /SUPABASE_AUTH_PASSWORD_HASH_PLACEHOLDER/);
  assert.equal(ensureSource.includes("workspaceMembers"), false);
});

test("operator profile fields are nullable and onboarding writes completion timestamp", () => {
  const schemaSource = readFileSync("src/db/schema.ts", "utf8");
  const migrationSource = readFileSync(
    "drizzle/0009_operator_profile_fields.sql",
    "utf8",
  );
  const pageSource = readFileSync(
    "src/app/dashboard/onboarding/profile/page.tsx",
    "utf8",
  );
  const formSource = readFileSync(
    "src/components/operator/operator-profile-onboarding-form.tsx",
    "utf8",
  );
  const sessionSource = readFileSync(
    "src/server/operator-api/supabase-session.ts",
    "utf8",
  );

  assert.match(schemaSource, /displayName: text\("display_name"\)/);
  assert.match(
    schemaSource,
    /profileCompletedAt: timestampColumn\("profile_completed_at"\)/,
  );
  assert.match(migrationSource, /ADD COLUMN "display_name" text/);
  assert.match(
    migrationSource,
    /ADD COLUMN "profile_completed_at" timestamp with time zone/,
  );
  assert.match(sessionSource, /update\(operatorUsers\)/);
  assert.match(sessionSource, /displayName: input\.profile\.displayName/);
  assert.match(sessionSource, /profileCompletedAt: new Date\(\)/);
  assert.match(pageSource, /validateOperatorProfileInput/);
  assert.match(pageSource, /updateOperatorProfileForAuthUser/);
  assert.match(pageSource, /getDashboardNewOrganizationPath\(\)/);
  assert.match(formSource, /name="displayName"/);
  assert.match(formSource, /Imię i nazwisko/);
});

test("signup page handles email confirmation and does not ask for profile data", () => {
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
  assert.equal(formSource.includes("signup-display-name"), false);
  assert.equal(formSource.includes('name="displayName"'), false);
  assert.equal(/Imię lub ksywka|display name/i.test(formSource), false);
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

test("new signed-up operator without profile follows profile onboarding first", () => {
  const dashboardRoutesSource = readFileSync(
    "src/lib/dashboard-routes.ts",
    "utf8",
  );
  const dashboardPageSource = readFileSync("src/app/dashboard/page.tsx", "utf8");
  const newOrganizationPageSource = readFileSync(
    "src/app/dashboard/new/page.tsx",
    "utf8",
  );

  assert.match(dashboardRoutesSource, /return "\/dashboard\/onboarding\/profile"/);
  assert.match(dashboardRoutesSource, /return "\/dashboard\/new"/);
  assert.match(dashboardPageSource, /isOperatorProfileCompleted/);
  assert.match(dashboardPageSource, /getDashboardProfileOnboardingPath\(\)/);
  assert.match(dashboardPageSource, /organizations\.length === 0/);
  assert.match(dashboardPageSource, /listDashboardOrganizationsForAuthUser/);
  assert.match(dashboardPageSource, /resolveDashboardHomeRedirect/);
  assert.match(newOrganizationPageSource, /isOperatorProfileCompleted/);
  assert.match(newOrganizationPageSource, /getDashboardProfileOnboardingPath\(\)/);
  assert.match(newOrganizationPageSource, /createDashboardOrganizationForOperator/);
});

test("existing users with organizations are not blocked by missing profile timestamp", () => {
  const dashboardPageSource = readFileSync("src/app/dashboard/page.tsx", "utf8");
  const onboardingPageSource = readFileSync(
    "src/app/dashboard/onboarding/profile/page.tsx",
    "utf8",
  );

  assert.match(
    dashboardPageSource,
    /!isOperatorProfileCompleted\(session\.operator\)[\s\S]*organizations\.length === 0/,
  );
  assert.match(
    onboardingPageSource,
    /isOperatorProfileCompleted\(session\.operator\) \|\| organizations\.length > 0/,
  );
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
