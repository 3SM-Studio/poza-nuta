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

    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(page.locator("main main")).toHaveCount(0);
    const eventNavigation = page
      .getByRole("complementary")
      .locator('[aria-label="Nawigacja wydarzenia"]');
    await expect(
      eventNavigation.getByRole("link", { name: "Kolejka", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: "Aktualnie śpiewane" }),
    ).toBeVisible();
  });

  test("event share page loads when E2E_EVENT_ID is set", async ({
    page,
  }) => {
    const eventId = getOptionalE2EEventId();

    test.skip(
      !eventId,
      "Dashboard share smoke skipped. Missing env: E2E_EVENT_ID.",
    );

    const organizationId = getRequiredE2EEnv("E2E_ORG_PUBLIC_ID");

    await page.goto(`/dashboard/org/${organizationId}/events/${eventId}/share`);

    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(page.locator("main main")).toHaveCount(0);
    const eventNavigation = page
      .getByRole("complementary")
      .locator('[aria-label="Nawigacja wydarzenia"]');
    await expect(
      eventNavigation.getByRole("link", { name: "Link i QR", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Link dla gości")).toBeVisible();
  });

  test("event overview and settings share one responsive workspace shell", async ({
    page,
  }) => {
    const eventId = getOptionalE2EEventId();

    test.skip(
      !eventId,
      "Dashboard event workspace smoke skipped. Missing env: E2E_EVENT_ID.",
    );

    const organizationId = getRequiredE2EEnv("E2E_ORG_PUBLIC_ID");
    const eventPath =
      "/dashboard/org/" + organizationId + "/events/" + eventId;

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(eventPath);
      await expect(page.locator("main h1")).toHaveCount(1);
      await expect(page.locator("main main")).toHaveCount(0);
      const navigationScope =
        viewport.width === 390
          ? await openMobileSidebar(page)
          : page.getByRole("complementary");
      const eventNavigation = navigationScope.locator(
        '[aria-label="Nawigacja wydarzenia"]',
      );
      await expect(
        eventNavigation.getByRole("link", {
          name: "Przegląd",
          exact: true,
        }),
      ).toHaveAttribute("aria-current", "page");
      if (viewport.width === 390) {
        await eventNavigation
          .getByRole("link", { name: "Kolejka", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toBeHidden();
        await expect(page).toHaveURL(eventPath + "/queue");
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }

    await page.goto(eventPath + "/settings");
    await expect(page.locator("main h1")).toHaveCount(1);
    const eventNavigation = page
      .getByRole("complementary")
      .locator('[aria-label="Nawigacja wydarzenia"]');
    await expect(
      eventNavigation.getByRole("link", { name: "Ustawienia", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });
});

async function openMobileSidebar(page: import("@playwright/test").Page) {
  const trigger = page.getByRole("button", { name: "Otwórz menu" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  return page.getByRole("dialog");
}
