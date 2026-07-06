import { expect, test } from "@playwright/test";

import { getOptionalE2ESessionCode } from "./e2e-env";

test.describe("public smoke", () => {
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
