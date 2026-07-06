import { expect, test } from "@playwright/test";

import {
  getMissingDashboardSmokeEnv,
  getOptionalE2EEventId,
  getRequiredE2EEnv,
  readDashboardAuthSetupStatus,
} from "./e2e-env";

const missingEnv = getMissingDashboardSmokeEnv();

test.describe("dashboard authenticated smoke", () => {
  test.beforeEach(() => {
    if (missingEnv.length > 0) {
      test.skip(
        true,
        `Dashboard E2E skipped. Missing env: ${missingEnv.join(", ")}.`,
      );
      return;
    }

    const authStatus = readDashboardAuthSetupStatus();

    if (!authStatus) {
      test.skip(
        true,
        "Dashboard E2E skipped. Auth state was not prepared by dashboard-auth-setup.",
      );
      return;
    }

    if (authStatus.status !== "success") {
      test.skip(true, authStatus.message);
    }
  });

  test("organization events page loads after login", async ({ page }) => {
    const organizationId = getRequiredE2EEnv("E2E_ORG_PUBLIC_ID");

    await page.goto(`/dashboard/org/${organizationId}/events`);

    await expect(page.getByRole("heading", { name: "Eventy" })).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
  });

  test("event queue page loads when E2E_EVENT_ID is set", async ({ page }) => {
    const eventId = getOptionalE2EEventId();

    test.skip(
      !eventId,
      "Dashboard queue smoke skipped. Missing env: E2E_EVENT_ID.",
    );

    const organizationId = getRequiredE2EEnv("E2E_ORG_PUBLIC_ID");

    await page.goto(`/dashboard/org/${organizationId}/events/${eventId}/queue`);

    await expect(
      page.getByRole("heading", { name: "Kolejka wydarzenia" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Aktualnie śpiewane" }),
    ).toBeVisible();
  });
});
