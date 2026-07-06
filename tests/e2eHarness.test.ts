import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Playwright public project is independent from dashboard auth setup", () => {
  const configSource = readFileSync("playwright.config.ts", "utf8");
  const setupSource = readFileSync("tests/e2e/dashboard-auth.setup.ts", "utf8");
  const dashboardSource = readFileSync("tests/e2e/dashboard.spec.ts", "utf8");
  const publicSource = readFileSync("tests/e2e/public.spec.ts", "utf8");
  const publicProjectStart = configSource.indexOf('name: "public"');
  const dashboardProjectStart = configSource.indexOf('name: "dashboard"');
  const publicProjectSource = configSource.slice(
    publicProjectStart,
    dashboardProjectStart,
  );

  assert.equal(configSource.includes("globalSetup"), false);
  assert.match(configSource, /name: "dashboard-auth-setup"/);
  assert.match(configSource, /dependencies: \["dashboard-auth-setup"\]/);
  assert.match(publicProjectSource, /testMatch: \/public\\\.spec\\\.ts\//);
  assert.equal(publicProjectSource.includes("dependencies"), false);

  assert.match(setupSource, /profile_onboarding_required/);
  assert.match(setupSource, /no_organization/);
  assert.match(setupSource, /credentials_error/);
  assert.match(setupSource, /storageState\(\{ path: E2E_AUTH_STATE_PATH \}\)/);
  assert.equal(setupSource.includes("E2E_OPERATOR_PASSWORD).toString"), false);

  assert.match(dashboardSource, /readDashboardAuthSetupStatus/);
  assert.match(dashboardSource, /authStatus\.status !== "success"/);
  assert.match(publicSource, /getByLabel\("Email"\)/);
  assert.match(publicSource, /getByLabel\("Imię lub ksywka"\)\)\.toHaveCount\(0\)/);
});
