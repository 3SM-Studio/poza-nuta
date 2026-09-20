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
const songDetailsViewports = [
  { width: 390, height: 844, mode: "mobile" as const },
  { width: 430, height: 932, mode: "mobile" as const },
  { width: 768, height: 1024, mode: "centered" as const },
  { width: 1024, height: 768, mode: "centered" as const },
  { width: 1280, height: 800, mode: "centered" as const },
  { width: 1440, height: 900, mode: "centered" as const },
  { width: 1920, height: 1080, mode: "centered" as const },
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

  test("song details drawer preserves responsive geometry and interactions across entry points", async ({ page }) => {
    test.setTimeout(60_000);

    for (const viewport of songDetailsViewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${fixturePath}?screen=song-details`);
      await assertSongDetailsGeometry(page, viewport.width, viewport.height, viewport.mode);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    for (const state of ["search-results", "discovery", "catalog-hits"] as const) {
      await page.goto(`${fixturePath}?screen=${state}`);
      const trigger = page.getByRole("button", { name: /Dancing Queen/ }).first();
      await trigger.focus();
      await trigger.press("Enter");
      await assertSongDetailsGeometry(page, 1280, 800, "centered");
      const drawer = page.locator('[data-slot="drawer-content"]');
      await expect(drawer.getByRole("heading", { name: "Dancing Queen" })).toBeVisible();
      await expect(drawer.getByText("ABBA", { exact: true })).toBeVisible();
      await expect(drawer.getByText("KaraFun", { exact: true })).toBeVisible();
      await expect(drawer.getByText("3:51", { exact: true })).toBeVisible();
      await expect(drawer.getByRole("button", { name: "Dodaj do kolejki" })).toBeVisible();

      await page.getByRole("button", { name: "Zamknij szczegóły utworu" }).click();
      await expect(page.locator('[data-slot="drawer-content"]')).toBeHidden();
      await expect(trigger).toBeFocused();
      await assertDrawerCleanup(page);
    }

    await page.goto(`${fixturePath}?screen=search-results`);
    const nextTrigger = page.getByRole("button", { name: /Mamma Mia/ }).first();
    await nextTrigger.focus();
    await nextTrigger.press("Enter");
    await expect(page.getByRole("heading", { name: "Mamma Mia" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-slot="drawer-content"]')).toBeHidden();
    await expect(nextTrigger).toBeFocused();
    await assertDrawerCleanup(page);

    await page.goto(`${fixturePath}?screen=long-song-details`);
    const title = page.locator('[data-slot="drawer-title"]');
    await expect(title).toBeVisible();
    await expect(title).toHaveCSS("text-overflow", "ellipsis");
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("participant search preserves input behavior while rendering relevance order", async ({ page }) => {
    const queries: string[] = [];
    const pokerFace = {
      id: 101,
      source: "ising" as const,
      title: "Poker Face",
      artist: "Lady Gaga",
      durationSeconds: 237,
      isDuet: false,
      isExplicit: false,
      isPlus: false,
      isHit: true,
    };
    const weakMatch = {
      ...pokerFace,
      id: 102,
      source: "karafun" as const,
      title: "Poker Night",
      artist: "The Faces",
    };

    await page.route("**/api/s/visual-fixture-session-token/songs/search?*", async (route) => {
      const requestUrl = new URL(route.request().url());
      const query = requestUrl.searchParams.get("q") ?? "";
      const cursor = requestUrl.searchParams.get("cursor");
      queries.push(query);

      if (query === "slow query" || (query === "paged slow" && cursor)) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }

      const items = query === "fast query"
        ? [{ ...pokerFace, id: 103, title: "Fast Result" }]
        : query === "paged query" && cursor
          ? [{ ...pokerFace, id: 104, title: "Second Page Result" }]
          : query === "paged query" || query === "paged slow"
            ? [{ ...pokerFace, id: 105, title: "First Page Result" }]
        : query.toLocaleLowerCase().includes("poker") || query.toLocaleLowerCase().includes("ladi")
          ? [pokerFace, weakMatch]
          : [];
      const nextCursor = (query === "paged query" || query === "paged slow") && !cursor
        ? "fixture-next-cursor"
        : null;

      await route.fulfill({ json: { items, nextCursor } }).catch(() => undefined);
    });

    await page.goto(`${fixturePath}?screen=instrumented-search`);
    const searchbox = page.getByRole("searchbox");
    await searchbox.click();
    await expect(searchbox).toBeFocused();

    await searchbox.fill("A");
    await page.waitForTimeout(350);
    expect(queries).toEqual([]);
    await expect(page.getByRole("heading", { name: "Kolekcje" })).toBeVisible();

    await searchbox.pressSequentially("B", { delay: 20 });
    await expect.poll(() => queries).toEqual(["AB"]);

    await searchbox.fill("");
    const beforeRapidTyping = queries.length;
    await searchbox.fill("Lady Gaga");
    await expect.poll(() => queries.length).toBe(beforeRapidTyping + 1);
    expect(queries.at(-1)).toBe("Lady Gaga");

    await searchbox.press("Space");
    await expect(searchbox).toHaveValue("Lady Gaga ");
    await page.waitForTimeout(300);
    expect(queries.at(-1)).toBe("Lady Gaga");
    await searchbox.press("Backspace");
    await expect(searchbox).toHaveValue("Lady Gaga");
    await expect(searchbox).toBeFocused();

    await searchbox.fill("Poker Face Lady Gaga");
    await expect(page.getByRole("button", { name: /Poker Face/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Poker Face/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /Poker Night/ })).toHaveCount(1);
    expect(await page.locator("ul button").first().innerText()).toContain("Poker Face");

    await searchbox.fill("Ladi Gaga");
    await expect.poll(() => queries.at(-1)).toBe("Ladi Gaga");
    await expect(page.locator("ul button").first()).toContainText("Poker Face");

    await searchbox.fill("slow query");
    await expect.poll(() => queries.at(-1)).toBe("slow query");
    await searchbox.fill("fast query");
    await expect(page.getByText("Fast Result")).toBeVisible();
    await page.waitForTimeout(700);
    await expect(page.getByText("Fast Result")).toBeVisible();

    await searchbox.fill("paged query");
    await expect(page.getByText("First Page Result")).toBeVisible();
    await page.getByRole("button", { name: "Pokaż więcej" }).click();
    await expect(page.getByText("Second Page Result")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pokaż więcej" })).toHaveCount(0);
    await expect(searchbox).toBeFocused();

    await searchbox.fill("paged slow");
    await expect(page.getByText("First Page Result")).toBeVisible();
    await page.getByRole("button", { name: "Pokaż więcej" }).click();
    await searchbox.fill("fast query");
    await expect(page.getByText("Fast Result")).toBeVisible();
    await page.waitForTimeout(700);
    await expect(page.getByText("Second Page Result")).toHaveCount(0);
    await expect(searchbox).toBeFocused();

    await searchbox.fill("");
    await expect(searchbox).toHaveValue("");
    await expect(page.getByRole("heading", { name: "Kolekcje" })).toBeVisible();
    await expect(searchbox).toBeFocused();
  });
});

async function hasHorizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

async function assertSongDetailsGeometry(
  page: import("@playwright/test").Page,
  viewportWidth: number,
  viewportHeight: number,
  mode: "mobile" | "centered",
) {
  const drawer = page.locator('[data-slot="drawer-content"]');
  const overlay = page.locator('[data-slot="drawer-overlay"]');
  await expect(drawer).toBeVisible();
  await expect(overlay).toBeVisible();

  const drawerBox = await drawer.boundingBox();
  const overlayBox = await overlay.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(overlayBox).not.toBeNull();
  if (!drawerBox || !overlayBox) return;

  expect(overlayBox.x).toBeCloseTo(0, 0);
  expect(overlayBox.y).toBeCloseTo(0, 0);
  expect(overlayBox.width).toBeCloseTo(viewportWidth, 0);
  expect(overlayBox.height).toBeCloseTo(viewportHeight, 0);
  expect(await hasHorizontalOverflow(page)).toBe(false);

  if (mode === "mobile") {
    expect(drawerBox.x).toBeCloseTo(0, 0);
    expect(drawerBox.width).toBeCloseTo(viewportWidth, 0);
    return;
  }

  expect(drawerBox.x).toBeGreaterThan(0);
  expect(drawerBox.width).toBeLessThanOrEqual(641);
  expect(Math.abs(drawerBox.x + drawerBox.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(2);
}

async function assertDrawerCleanup(page: import("@playwright/test").Page) {
  await expect.poll(() => page.evaluate(() => ({
    overflow: document.body.style.overflow,
    pointerEvents: document.body.style.pointerEvents,
    inert: document.querySelectorAll("[inert]").length,
    overlay: document.querySelectorAll('[data-slot="drawer-overlay"]').length,
  }))).toEqual({ overflow: "", pointerEvents: "", inert: 0, overlay: 0 });
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
