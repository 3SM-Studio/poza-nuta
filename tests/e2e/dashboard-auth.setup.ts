import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { test } from "@playwright/test";

import {
  E2E_AUTH_STATE_PATH,
  E2E_DASHBOARD_AUTH_STATUS_PATH,
  getMissingDashboardAuthEnv,
  getRequiredE2EEnv,
  type DashboardAuthSetupStatus,
} from "./e2e-env";

test("prepare dashboard auth state", async ({ page }) => {
  await mkdir(dirname(E2E_AUTH_STATE_PATH), { recursive: true });

  const missingEnv = getMissingDashboardAuthEnv();

  if (missingEnv.length > 0) {
    await writeDashboardAuthSetupResult({
      status: "missing_env",
      message: `Dashboard E2E auth setup skipped. Missing env: ${missingEnv.join(
        ", ",
      )}.`,
      path: null,
      hasOperatorEmail: Boolean(process.env.E2E_OPERATOR_EMAIL?.trim()),
      hasOrgPublicId: Boolean(process.env.E2E_ORG_PUBLIC_ID?.trim()),
      missingEnv,
    });
    await page.context().storageState({ path: E2E_AUTH_STATE_PATH });
    return;
  }

  try {
    await page.goto("/sign-in");
    await page
      .locator("#operator-email")
      .fill(getRequiredE2EEnv("E2E_OPERATOR_EMAIL"));
    await page
      .locator("#operator-password")
      .fill(getRequiredE2EEnv("E2E_OPERATOR_PASSWORD"));

    await Promise.all([
      page
        .waitForURL((url) => isExpectedPostLoginPath(url.pathname), {
          timeout: 12_000,
        })
        .catch(() => null),
      page.locator("form button[type='submit']").click(),
    ]);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => null);

    const currentUrl = new URL(page.url());
    const status = getDashboardAuthSetupStatus(currentUrl.pathname);

    if (status.status === "success") {
      await page.context().storageState({ path: E2E_AUTH_STATE_PATH });
    } else {
      await page.context().clearCookies();
      await page.context().storageState({ path: E2E_AUTH_STATE_PATH });
    }

    await writeDashboardAuthSetupResult(status);
  } catch {
    await page.context().storageState({ path: E2E_AUTH_STATE_PATH });
    await writeDashboardAuthSetupResult({
      status: "unexpected",
      message:
        "Dashboard E2E auth setup failed before a dashboard state could be detected.",
      path: null,
      hasOperatorEmail: Boolean(process.env.E2E_OPERATOR_EMAIL?.trim()),
      hasOrgPublicId: Boolean(process.env.E2E_ORG_PUBLIC_ID?.trim()),
    });
  }
});

function isExpectedPostLoginPath(pathname: string) {
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/sign-in"
  );
}

function getDashboardAuthSetupStatus(pathname: string): DashboardAuthSetupStatus {
  const hasOperatorEmail = Boolean(process.env.E2E_OPERATOR_EMAIL?.trim());
  const hasOrgPublicId = Boolean(process.env.E2E_ORG_PUBLIC_ID?.trim());

  if (pathname === "/dashboard/onboarding/profile") {
    return {
      status: "profile_onboarding_required",
      message:
        "E2E operator requires profile onboarding. Complete profile or use an E2E account with profile_completed_at.",
      path: pathname,
      hasOperatorEmail,
      hasOrgPublicId,
    };
  }

  if (pathname === "/dashboard/new") {
    return {
      status: "no_organization",
      message:
        "E2E operator has no organization. Set up E2E_ORG_PUBLIC_ID with a completed organization membership.",
      path: pathname,
      hasOperatorEmail,
      hasOrgPublicId,
    };
  }

  if (pathname === "/sign-in") {
    return {
      status: "credentials_error",
      message:
        "Dashboard E2E login did not reach the dashboard. Check E2E_OPERATOR_EMAIL and E2E_OPERATOR_PASSWORD.",
      path: pathname,
      hasOperatorEmail,
      hasOrgPublicId,
    };
  }

  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return {
      status: "success",
      message: "Dashboard E2E auth state prepared.",
      path: pathname,
      hasOperatorEmail,
      hasOrgPublicId,
    };
  }

  return {
    status: "unexpected",
    message: `Dashboard E2E login reached an unexpected path: ${pathname}.`,
    path: pathname,
    hasOperatorEmail,
    hasOrgPublicId,
  };
}

async function writeDashboardAuthSetupResult(status: DashboardAuthSetupStatus) {
  await writeFile(
    E2E_DASHBOARD_AUTH_STATUS_PATH,
    `${JSON.stringify(status, null, 2)}\n`,
    "utf8",
  );
}
