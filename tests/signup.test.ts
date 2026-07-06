import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { mapSupabaseSignupError } from "../src/server/operator-api/auth-policy.ts";
import { validateSignupInput } from "../src/server/operator-api/validation.ts";

test("/sign-up route and signup API exist", () => {
  assert.equal(existsSync("src/app/sign-up/page.tsx"), true);
  assert.equal(existsSync("src/app/api/dashboard/signup/route.ts"), true);
});

test("validateSignupInput accepts valid signup data and trims public fields", () => {
  assert.deepEqual(
    validateSignupInput({
      email: "  NEW@EXAMPLE.COM  ",
      password: "secret123",
      confirmPassword: "secret123",
      displayName: "  Nowy Operator  ",
    }),
    {
      success: true,
      data: {
        email: "new@example.com",
        password: "secret123",
        displayName: "Nowy Operator",
      },
    },
  );
});

test("validateSignupInput rejects missing email and invalid email", () => {
  const missingEmail = validateSignupInput({
    email: "",
    password: "secret123",
    confirmPassword: "secret123",
    displayName: "Operator",
  });
  const invalidEmail = validateSignupInput({
    email: "not-an-email",
    password: "secret123",
    confirmPassword: "secret123",
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

test("validateSignupInput rejects short password and password mismatch", () => {
  const result = validateSignupInput({
    email: "new@example.com",
    password: "short",
    confirmPassword: "different",
    displayName: "Operator",
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.success ? [] : result.issues.map((issue) => issue.field),
    ["password", "confirmPassword"],
  );
});

test("validateSignupInput requires a display name within product limits", () => {
  const missingName = validateSignupInput({
    email: "new@example.com",
    password: "secret123",
    confirmPassword: "secret123",
    displayName: " ",
  });
  const shortName = validateSignupInput({
    email: "new@example.com",
    password: "secret123",
    confirmPassword: "secret123",
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

test("signup backend calls Supabase signUp with display name metadata", () => {
  const source = readFileSync(
    "src/server/operator-api/supabase-session.ts",
    "utf8",
  );

  assert.match(source, /supabase\.auth\.signUp\(/);
  assert.match(source, /emailRedirectTo: input\.emailRedirectTo/);
  assert.match(source, /data: \{\s*display_name: input\.data\.displayName/);
  assert.match(source, /name: input\.data\.displayName/);
  assert.match(source, /data\.user\.identities/);
  assert.match(source, /SIGNUP_FAILED/);
  assert.equal(source.includes("service_role"), false);
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
  assert.match(formSource, /Sprawdź email, aby potwierdzić konto/);
  assert.match(formSource, /Konto zostało utworzone\. Możesz się zalogować/);
  assert.match(formSource, /result\.status === "signed_in"/);
  assert.match(formSource, /router\.replace\("\/dashboard"\)/);
  assert.match(formSource, /Masz już konto\?/);
  assert.match(formSource, /href="\/sign-in"/);
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
