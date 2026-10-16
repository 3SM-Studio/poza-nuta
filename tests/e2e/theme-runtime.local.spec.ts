import { expect, test } from "@playwright/test";

test("theme bootstrap executes in SSR and client navigation preserves theme without script or hydration warnings", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  const page = await context.newPage();
  const warnings: string[] = [];
  page.on("console", message => {
    if (/Encountered a script tag|hydration failed|hydrated but|did not match/i.test(message.text())) warnings.push(message.text());
  });
  page.on("pageerror", error => warnings.push(error.message));
  try {
    // Only a theme preference is stored; never authentication/session state.
    await page.addInitScript(() => localStorage.setItem("pozanuta-admin-theme", "light"));
    const response = await page.goto(`${baseURL}/sign-in`);
    const html = await response!.text();
    expect(html).toMatch(/<script[^>]*type="text\/javascript"[^>]*>[\s\S]*?pozanuta-admin-theme/);
    await expect(page.locator("html")).toHaveClass(/\blight\b/);
    await page.goto(`${baseURL}/events`);
    const toggle = page.getByRole("button", { name: "Wybierz motyw" }).first();
    await toggle.click(); await page.getByRole("menuitemradio", { name: "Ciemny", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await toggle.click(); await page.getByRole("menuitemradio", { name: "Systemowy", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/\blight\b/);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await page.locator('a[href="/dashboard"]').click();
    await expect(page).toHaveURL(/\/sign-in/);
    const signUp = page.locator('a[href="/sign-up"]').first();
    await signUp.click(); await expect(page).toHaveURL(/\/sign-up/);
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await page.goto(`${baseURL}/visual-fixture/public-session`);
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await page.reload(); await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    expect(warnings).toEqual([]);
  } finally { await context.close(); }
});
