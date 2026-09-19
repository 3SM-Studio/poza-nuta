import { expect, test } from "@playwright/test";

const fixturePath = "/visual-fixture/public-session";
const fullFlowViewports = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];
const responsiveSpotChecks = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 393, height: 852 },
  { width: 412, height: 915 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];
const lifecycleStates = [
  "scheduled",
  "closed",
  "closed-reopenable",
  "cancelled",
  "invalid-session",
  "service-unavailable",
  "page-rate-limited",
] as const;
const capabilityStates = [
  "capabilities-both",
  "capabilities-requests-only",
  "capabilities-queue-only",
  "capabilities-none",
] as const;

test.describe("public participant flow", () => {
  test("invalid join result keeps one visible and editable entry surface", async ({ page }) => {
    await page.goto("/join?joinError=invalid");
    const input = page.getByLabel("Sześciocyfrowy kod sesji");
    await expect(page.getByText("Nie znaleźliśmy aktywnego wydarzenia")).toBeVisible();
    await expect(input).toBeVisible();
    await expect(input).toBeEditable();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Sześciocyfrowy kod sesji")).toHaveCount(1);
  });

  test("join entry exposes mobile-safe OTP semantics and recovery copy", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${fixturePath}?screen=join-initial`);
    await page.waitForLoadState("networkidle");
    const input = page.getByLabel("Sześciocyfrowy kod sesji");
    await expect(input).toHaveAttribute("inputmode", "numeric");
    await expect(input).toHaveAttribute("autocomplete", "one-time-code");
    await expect(input).toHaveAttribute("maxlength", "6");
    expect(await input.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await expect(page.getByText("Możesz wkleić cały kod naraz.")).toBeVisible();

    await typeSessionCode(input, page.locator('[data-slot="input-otp-slot"]'), "004271");
    await expect(input).toHaveValue("004271");
    const submit = page.getByRole("button", { name: "Dołącz" });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole("button", { name: "Łączymy…" })).toBeDisabled();
    await expect(input).toHaveValue("004271");
  });

  test("lifecycle and capability states remain complete and actionable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const state of lifecycleStates) {
      await page.goto(`${fixturePath}?screen=${state}`);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByRole("link", { name: "Wpisz kod wydarzenia" })).toBeVisible();
      expect(await hasHorizontalOverflow(page)).toBe(false);
    }
    for (const state of capabilityStates) {
      await page.goto(`${fixturePath}?screen=${state}`);
      await expect(page.locator("body")).toBeVisible();
      expect(await hasHorizontalOverflow(page)).toBe(false);
    }
    await page.goto(`${fixturePath}?screen=capabilities-none`);
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Zmień swój nick" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Otwórz/ })).toHaveCount(0);

    await page.goto(`${fixturePath}?screen=capabilities-requests-only`);
    await expect(page.getByRole("button", { name: "Otwórz moje zgłoszenia" }).last()).toBeVisible();
  });

  test("full-flow viewport tier has no horizontal overflow or undersized text inputs", async ({ page }, testInfo) => {
    test.setTimeout(60_000);

    for (const viewport of fullFlowViewports) {
      await page.setViewportSize(viewport);
      for (const state of ["join-invalid", "participant-join", "scheduled", "discovery", "search-results", "song-details", "queue-mobile-expanded", "profile", "cancelled"] as const) {
        await page.goto(`${fixturePath}?screen=${state}`);
        await expect(page.locator("body")).toBeVisible();
        expect(await hasHorizontalOverflow(page), `${state} at ${viewport.width}x${viewport.height}`).toBe(false);
        const textInputs = page.locator("#session-code, #participant-display-name, #session-song-search");
        for (let index = 0; index < await textInputs.count(); index += 1) {
          const size = await textInputs.nth(index).evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
          expect(size).toBeGreaterThanOrEqual(16);
        }
      }
      await page.screenshot({ path: testInfo.outputPath(`flow-${viewport.width}x${viewport.height}.png`) });
    }
  });

  test("responsive spot checks and drawer breakpoint cleanup", async ({ page }) => {
    for (const viewport of responsiveSpotChecks) {
      await page.setViewportSize(viewport);
      await page.goto(`${fixturePath}?screen=discovery`);
      expect(await hasHorizontalOverflow(page)).toBe(false);
    }

    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto(`${fixturePath}?screen=queue-mobile-expanded`);
    const mobileQueueTrigger = page.locator('[data-slot="drawer-trigger"]');
    await expect(mobileQueueTrigger).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("complementary", { name: "Kolejka sesji" })).toBeVisible();
    await expect(page.locator('[data-slot="drawer-content"]')).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => ({ overflow: document.body.style.overflow, pointerEvents: document.body.style.pointerEvents, inert: document.querySelectorAll("[inert]").length }))).toEqual({ overflow: "", pointerEvents: "", inert: 0 });
  });
});

async function hasHorizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

async function typeSessionCode(
  input: import("@playwright/test").Locator,
  slots: import("@playwright/test").Locator,
  code: string,
) {
  await input.click();
  for (const [index, digit] of Array.from(code).entries()) {
    await input.press(digit);
    await expect(slots.nth(index)).toHaveText(digit);
  }
}
