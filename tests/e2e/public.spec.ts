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
    await expect(page.getByLabel("Imię lub ksywka")).toBeVisible();
  });

  test("sign-up page links to sign-in", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByRole("link", { name: "Zaloguj się" }).click();

    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(
      page.getByRole("heading", { name: "Logowanie do dashboardu" }),
    ).toBeVisible();
  });

  test("sign-up page validates empty and invalid fields without mutation", async ({
    page,
  }) => {
    await page.goto("/sign-up");
    await page.getByRole("button", { name: "Załóż konto" }).click();

    await expect(page.getByText("Podaj email.")).toBeVisible();
    await expect(page.getByText("Podaj imię lub ksywkę.")).toBeVisible();
    await expect(page.getByText("Podaj hasło.")).toBeVisible();
    await expect(page.getByText("Potwierdź hasło.")).toBeVisible();

    await page.getByLabel("Email").fill("nie-email");
    await page.getByLabel("Imię lub ksywka").fill("Tester");
    await page.getByLabel("Hasło", { exact: true }).fill("secret123");
    await page.getByLabel("Potwierdź hasło").fill("secret124");
    await page.getByRole("button", { name: "Załóż konto" }).click();

    await expect(page.getByText("Podaj poprawny email.")).toBeVisible();
    await expect(page.getByText("Hasła muszą być takie same.")).toBeVisible();
  });

  test("public queue loads without dashboard auth", async ({ page }) => {
    await page.goto("/queue");

    await expect(
      page.getByRole("heading", { name: "Publiczna kolejka" }),
    ).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
  });

  test("session route loads without dashboard auth", async ({ page }) => {
    const code = getOptionalE2ESessionCode();

    await page.goto(`/session/${encodeURIComponent(code)}`);

    await expect(page.locator("main")).toBeVisible();
    await expect(
      page.locator("main"),
    ).toContainText(/Link sesji|Wybierz piosenkę/);
  });
});
