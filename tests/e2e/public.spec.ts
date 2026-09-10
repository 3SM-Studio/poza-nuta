import { expect, test } from "@playwright/test";

import { getOptionalE2ESessionCode } from "./e2e-env";

test.describe("public smoke", () => {
  test("sign-up page renders without dashboard auth", async ({ page }) => {
    await page.goto("/sign-up");

    await expect(
      page.getByRole("heading", { name: "Załóż konto" }),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Hasło", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Potwierdź hasło")).toBeVisible();
    await expect(page.getByLabel("Imię lub ksywka")).toHaveCount(0);
    await expect(page.getByLabel("Imię i nazwisko")).toHaveCount(0);
    await expect(page.getByLabel("Wymagania hasła")).toContainText(
      "Minimum 8 znaków",
    );
    await expect(page.getByText("GitHub")).toHaveCount(0);
    await expect(page.getByText("SSO")).toHaveCount(0);
  });

  test("sign-up page links to sign-in", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByRole("link", { name: "Zaloguj się" }).click();

    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(
      page.getByRole("heading", { name: "Logowanie do dashboardu" }),
    ).toBeVisible();
  });

  test("sign-in page links to sign-up", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Zarejestruj się" }).click();

    await expect(page).toHaveURL(/\/sign-up$/);
    await expect(
      page.getByRole("heading", { name: "Załóż konto" }),
    ).toBeVisible();
  });

  test("sign-up page validates empty, weak and mismatched fields without mutation", async ({
    page,
  }) => {
    await page.goto("/sign-up");
    await page.getByRole("button", { name: "Załóż konto" }).click();

    await expect(page.getByText("Podaj email.")).toBeVisible();
    await expect(page.getByText("Podaj hasło.")).toBeVisible();
    await expect(page.getByText("Potwierdź hasło.")).toBeVisible();

    await page.getByLabel("Email").fill("nie-email");
    await page.getByLabel("Hasło", { exact: true }).fill("weakpass");
    await page.getByLabel("Potwierdź hasło").fill("Secret123!");
    await page.getByRole("button", { name: "Załóż konto" }).click();

    await expect(page.getByText("Podaj poprawny email.")).toBeVisible();
    await expect(
      page.getByText("Hasło nie spełnia wszystkich wymagań."),
    ).toBeVisible();
    await expect(page.getByText("Hasła muszą być takie same.")).toBeVisible();
    await expect(page.getByLabel("Wymagania hasła")).toContainText(
      "Wielka litera",
    );
  });

  test("global public queue page is removed", async ({ page }) => {
    const response = await page.goto("/queue");

    expect(response?.status()).toBe(404);
  });

  test("admin redirects an unauthenticated visitor to sign-in", async ({ page }) => {
    await page.goto("/admin");

    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(
      page.getByRole("heading", { name: "Logowanie do dashboardu" }),
    ).toBeVisible();
  });

  test("public and protected entry points remain stable across supported widths", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });

      for (const route of ["/", "/events"]) {
        const response = await page.goto(route);

        expect(response?.status()).toBeLessThan(500);
        await expect(page.locator("main")).toBeVisible();
        expect(await hasHorizontalOverflow(page)).toBe(false);
      }

      const dashboardResponse = await page.goto("/dashboard");
      expect(dashboardResponse?.status()).toBeLessThan(500);
      await expect(page).toHaveURL(/\/sign-in$/);
      expect(await hasHorizontalOverflow(page)).toBe(false);
    }

    expect(
      consoleErrors.filter((message) =>
        /hydration|uncaught|unhandled|error:/i.test(message),
      ),
    ).toEqual([]);
  });

  test("session route loads without dashboard auth", async ({ page }) => {
    const code = getOptionalE2ESessionCode();

    await page.goto(`/session/${encodeURIComponent(code)}`);

    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("main")).toContainText(/Link sesji|Wybierz piosenkę/);
  });
});

async function hasHorizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
}
