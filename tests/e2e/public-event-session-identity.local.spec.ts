import { expect, test } from "@playwright/test";

import {
  createLocalSupabaseFixture,
  type LocalSupabaseFixture,
} from "./local-supabase-fixture";

test.describe.configure({ mode: "serial" });

test.describe("public event and session identity with local Supabase Auth", () => {
  let fixture: LocalSupabaseFixture;

  test.setTimeout(240_000);

  test.beforeAll(async () => {
    fixture = await createLocalSupabaseFixture();
  });

  test.afterAll(async () => {
    await fixture?.cleanup();
  });

  test("covers authenticated lifecycle and canonical public access", async ({
    browser,
  }) => {
    const authenticatedContext = await browser.newContext();
    const anonymousContext = await browser.newContext();
    const page = await authenticatedContext.newPage();
    const anonymousPage = await anonymousContext.newPage();
    const browserErrors: string[] = [];

    observeBrowserErrors(page, browserErrors);
    observeBrowserErrors(anonymousPage, browserErrors);

    try {
      await page.goto("/sign-in");
      await page.getByLabel("E-mail").fill(fixture.email);
      await page.getByLabel("Hasło").fill(fixture.password);
      await page.getByRole("button", { name: "Zaloguj się" }).click();
      await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);

      const eventBasePath = `/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}`;
      const settingsPath = `${eventBasePath}/settings`;
      const sharePath = `${eventBasePath}/share`;
      const queuePath = `${eventBasePath}/queue`;

      await page.goto(eventBasePath);
      await expect(page.getByRole("heading", { name: fixture.eventName })).toBeVisible();
      expect(new URL(page.url()).pathname).toContain(fixture.eventPublicId);

      await anonymousPage.goto("/join");
      await anonymousPage.locator("#session-code").fill(fixture.sessionCode);
      await anonymousPage.getByRole("button", { name: "Dołącz" }).click();
      await expect(anonymousPage).toHaveURL(
        new RegExp(`/s/${escapeRegExp(fixture.publicToken)}$`),
      );
      await expect(
        anonymousPage.getByRole("heading", { name: fixture.eventName }),
      ).toBeVisible();

      await page.goto(sharePath);
      await expect(
        page.getByRole("heading", { name: "Udostępnij wydarzenie" }),
      ).toBeVisible();
      await expect(page.getByText(`/s/${fixture.publicToken}`, { exact: false })).toBeVisible();
      await expect(page.getByAltText(/Kod QR/)).toBeVisible();

      await page.goto(settingsPath);
      const beforeRotation = await fixture.readEventState();
      const dashboardMain = page.locator("#dashboard-main");
      const rotationForm = dashboardMain.locator(
        "#event-session-code-rotation-form",
      );
      await expect(rotationForm).toBeVisible();
      console.log("[local-e2e] Rotating the session code.");
      await rotationForm.locator('button[type="button"]').click();
      const rotationAction = page
        .getByRole("alertdialog")
        .getByRole("button")
        .last();
      await expect(rotationAction).toHaveAttribute("type", "submit");
      await expect(rotationAction).toHaveAttribute(
        "form",
        "event-session-code-rotation-form",
      );
      await rotationAction.click();
      await waitForEventMutationOrActionError({
        page,
        didMutate: async () => {
          const state = await fixture.readEventState();
          return state.sessionCode !== beforeRotation.sessionCode;
        },
        actionName: "session code rotation",
      });

      const afterRotation = await fixture.readEventState();
      expect(afterRotation.sessionCode).not.toBe(beforeRotation.sessionCode);
      expect(afterRotation.publicToken).toBe(beforeRotation.publicToken);

      await anonymousPage.goto(`/join/${beforeRotation.sessionCode}`);
      await expect(anonymousPage).toHaveURL(/\/join\?joinError=invalid$/);
      await anonymousPage.goto("/join");
      await anonymousPage.locator("#session-code").fill(afterRotation.sessionCode);
      await anonymousPage.getByRole("button", { name: "Dołącz" }).click();
      await expect(anonymousPage).toHaveURL(
        new RegExp(`/s/${escapeRegExp(fixture.publicToken)}$`),
      );

      await page.goto(settingsPath);
      const beforeExtension = await fixture.readEventState();
      const extendForm = page
        .locator("#dashboard-main")
        .locator("#event-extend-form");
      await expect(extendForm).toBeVisible();
      console.log("[local-e2e] Extending the active event.");
      await extendForm.locator('button[type="button"]').first().click();
      await page.getByRole("alertdialog").getByRole("button").last().click();
      await expect(page).toHaveURL(/eventAction=extended/);

      const afterExtension = await fixture.readEventState();
      expect(afterExtension.autoCloseAt!.getTime()).toBeGreaterThan(
        beforeExtension.autoCloseAt!.getTime(),
      );

      await page.goto(queuePath);
      await expect(
        page.getByRole("heading", { name: "Kolejka wydarzenia" }),
      ).toBeVisible();
      await expect(
        page
          .locator("strong:visible")
          .filter({ hasText: fixture.requestDisplayName }),
      ).toBeVisible();

      await page.goto(settingsPath);
      const closeForm = page
        .locator("#dashboard-main")
        .locator("#event-close-form");
      await expect(closeForm).toBeVisible();
      console.log("[local-e2e] Closing the event.");
      await closeForm.locator('button[type="button"]').click();
      await page.getByRole("alertdialog").getByRole("button").last().click();
      await expect(page).toHaveURL(/eventAction=closed/);

      const closedState = await fixture.readEventState();
      expect(closedState.status).toBe("closed");
      expect(closedState.isActivePublicEvent).toBe(false);
      expect(closedState.closedAt).not.toBeNull();
      expect(closedState.requestStatus).toBe("pending");

      await anonymousPage.goto(`/s/${fixture.publicToken}`);
      await expect(anonymousPage.getByText("Sesja zakończona")).toBeVisible();
      await expect(anonymousPage.getByRole("button", { name: /Dodaj/ })).toHaveCount(0);

      await page.goto(queuePath);
      await expect(
        page
          .locator("strong:visible")
          .filter({ hasText: fixture.requestDisplayName }),
      ).toBeVisible();

      await page.goto(settingsPath);
      const reopenForm = page
        .locator("#dashboard-main")
        .locator("#event-reopen-form");
      await expect(reopenForm).toBeVisible();
      console.log("[local-e2e] Reopening the event inside the grace window.");
      await reopenForm.locator('button[type="button"]').first().click();
      await page.getByRole("alertdialog").getByRole("button").last().click();
      await expect(page).toHaveURL(/eventAction=reopened/);

      const reopenedState = await fixture.readEventState();
      expect(reopenedState.status).toBe("active");
      expect(reopenedState.isActivePublicEvent).toBe(true);
      expect(reopenedState.closedAt).toBeNull();
      expect(reopenedState.requestStatus).toBe("pending");

      await anonymousPage.goto(`/join/${reopenedState.sessionCode}`);
      await expect(anonymousPage).toHaveURL(
        new RegExp(`/s/${escapeRegExp(fixture.publicToken)}$`),
      );
      await expect(
        anonymousPage.getByRole("heading", { name: fixture.eventName }),
      ).toBeVisible();

      await page.goto(queuePath);
      await expect(
        page
          .locator("strong:visible")
          .filter({ hasText: fixture.requestDisplayName }),
      ).toBeVisible();
      expect(browserErrors).toEqual([]);
    } finally {
      await Promise.allSettled([
        anonymousContext.close(),
        authenticatedContext.close(),
      ]);
    }
  });
});

function observeBrowserErrors(
  page: import("@playwright/test").Page,
  errors: string[],
) {
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(
        `HTTP ${response.status()} ${sanitizeBrowserUrl(response.url())}`,
      );
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
}

function sanitizeBrowserUrl(value: string) {
  const pathname = new URL(value).pathname;

  return pathname
    .replace(/^\/api\/s\/[^/]+/, "/api/s/[redacted]")
    .replace(/^\/s\/[^/]+/, "/s/[redacted]")
    .replace(/^\/join\/[^/]+/, "/join/[redacted]");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForEventMutationOrActionError({
  page,
  didMutate,
  actionName,
}: {
  page: import("@playwright/test").Page;
  didMutate: () => Promise<boolean>;
  actionName: string;
}) {
  await expect
    .poll(
      async () => {
        if (await didMutate()) {
          return "mutated";
        }

        const alert = page.locator("#dashboard-main").getByRole("alert");
        if ((await alert.count()) > 0 && (await alert.first().isVisible())) {
          return "action-error";
        }

        return "pending";
      },
      { timeout: 15_000 },
    )
    .not.toBe("pending");

  if (!(await didMutate())) {
    const alert = page.locator("#dashboard-main").getByRole("alert").first();
    const message = (await alert.textContent())?.replace(/\s+/g, " ").trim();
    throw new Error(
      `${actionName} failed through the UI: ${message ?? "safe action error"}`,
    );
  }
}
