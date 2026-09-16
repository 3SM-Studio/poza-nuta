import { expect, test } from "@playwright/test";

import {
  createLocalSupabaseFixture,
  LOCAL_E2E_ROCK_SONG_COUNT,
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

  test("keeps real pointer and keyboard DnD aligned across desktop and mobile", async ({
    page,
  }) => {
    const browserErrors: string[] = [];
    observeBrowserErrors(page, browserErrors);
    await fixture.resetQueue();
    await signInLocalOperator(page, fixture);

    const queuePath = `/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`;
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(queuePath);
    await expect(
      page.getByRole("heading", { name: "Kolejka operacyjna" }),
    ).toBeVisible();

    const rejectedName = fixture.queueRequestNames.rejected;
    const approvedName = fixture.queueRequestNames.approved;
    const pendingName = fixture.queueRequestNames.pending;

    await dragQueueRequest({
      page,
      sourceLane: "rejected",
      requestName: rejectedName,
      targetLane: "approved",
      cancel: true,
      verifyGeometry: true,
    });
    await expectQueueStatus(fixture, rejectedName, "rejected");

    await dragQueueRequest({
      page,
      sourceLane: "approved",
      requestName: approvedName,
      targetLane: "rejected",
    });
    await expectQueueStatus(fixture, approvedName, "rejected");

    await dragQueueRequest({
      page,
      sourceLane: "rejected",
      requestName: rejectedName,
      targetLane: "approved",
      verifyGeometry: true,
    });
    await expectQueueStatus(fixture, rejectedName, "approved");

    await dragQueueRequest({
      page,
      sourceLane: "pending",
      requestName: pendingName,
      targetLane: "approved",
    });
    await expectQueueStatus(fixture, pendingName, "approved");

    const approvedLane = queueLane(page, "approved");
    const orderBefore = await queueRequestNamesInLane(approvedLane);
    await dragQueueRequest({
      page,
      sourceLane: "approved",
      requestName: pendingName,
      targetLane: "approved",
      targetRequestName: rejectedName,
    });
    await expect
      .poll(() => queueRequestNamesInLane(approvedLane))
      .not.toEqual(orderBefore);
    const persistedOrder = await queueRequestNamesInLane(approvedLane);
    await expect
      .poll(async () =>
        (await fixture.readQueueRows())
          .filter((row) => row.status === "approved")
          .sort(
            (left, right) =>
              left.position - right.position || left.requestId - right.requestId,
          )
          .map((row) => ({
            displayName: row.displayName,
            position: row.position,
          })),
      )
      .toEqual(
        persistedOrder.map((displayName, index) => ({
          displayName,
          position: index + 1,
        })),
      );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Kolejka operacyjna" }),
    ).toBeVisible();
    expect(await queueRequestNamesInLane(approvedLane)).toEqual(persistedOrder);

    await dragQueueRequest({
      page,
      sourceLane: "rejected",
      requestName: approvedName,
      targetLane: "pending",
    });
    await expectQueueStatus(fixture, approvedName, "pending");

    const [keyboardReorderName, keyboardNeighborName] =
      await queueRequestNamesInLane(approvedLane);
    if (!keyboardReorderName || !keyboardNeighborName) {
      throw new Error("Keyboard DnD requires two approved requests.");
    }

    const keyboardReorderSource = queueRequest(
      page,
      "approved",
      keyboardReorderName,
    );
    const keyboardReorderHandle = keyboardReorderSource.getByRole("button", {
      name: new RegExp(
        `^Przeciągnij zgłoszenie: ${escapeRegExp(keyboardReorderName)}`,
      ),
    });
    await keyboardReorderHandle.focus();
    await keyboardReorderHandle.press("Space");
    await expect(page.locator("[data-queue-drag-overlay]")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.keyboard.press("Space");
    await expect
      .poll(() => queueRequestNamesInLane(approvedLane))
      .toEqual([keyboardNeighborName, keyboardReorderName]);
    await expect(
      queueRequest(page, "approved", keyboardReorderName),
    ).toBeFocused();

    const keyboardSource = queueRequest(
      page,
      "approved",
      keyboardReorderName,
    );
    const keyboardHandle = keyboardSource.getByRole("button", {
      name: new RegExp(
        `^Przeciągnij zgłoszenie: ${escapeRegExp(keyboardReorderName)}`,
      ),
    });
    await keyboardHandle.focus();
    await keyboardHandle.press("Space");
    await expect(page.locator("[data-queue-drag-overlay]")).toBeVisible();
    const rejectedDropStatus = queueLane(page, "rejected").getByRole("status");
    await page.keyboard.press("ArrowDown");
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(rejectedDropStatus).toContainText("Upuść w sekcji");
    await page.keyboard.press("Space");
    await expectQueueStatus(fixture, keyboardReorderName, "rejected");
    await expect(
      queueRequest(page, "rejected", keyboardReorderName),
    ).toBeFocused();

    const keyboardCancelSource = queueRequest(
      page,
      "approved",
      keyboardNeighborName,
    );
    const keyboardCancelHandle = keyboardCancelSource.getByRole("button", {
      name: new RegExp(
        `^Przeciągnij zgłoszenie: ${escapeRegExp(keyboardNeighborName)}`,
      ),
    });
    await keyboardCancelHandle.focus();
    await keyboardCancelHandle.press("Space");
    await expect(page.locator("[data-queue-drag-overlay]")).toBeVisible();
    await keyboardCancelHandle.press("Escape");
    await expect(page.locator("[data-queue-drag-overlay]")).toHaveCount(0);
    await expectQueueStatus(fixture, keyboardNeighborName, "approved");
    await expect(keyboardCancelSource).toBeFocused();

    await fixture.resetQueue();
    await page.setViewportSize({ width: 390, height: 390 });
    await page.reload();
    await expect(page.locator("[data-queue-board]:visible")).toBeVisible();
    await expect(queueLane(page, "pending")).toHaveCSS(
      "grid-column-start",
      "auto",
    );

    await dragQueueRequest({
      page,
      sourceLane: "rejected",
      requestName: rejectedName,
      targetLane: "pending",
      verifyGeometry: true,
      verifyAutoScroll: true,
    });
    await expectQueueStatus(fixture, rejectedName, "pending");
    expect(browserErrors).toEqual([]);
  });

  test("synchronizes the participant and dashboard queues through real Realtime", async ({
    browser,
  }) => {
    const dashboardContext = await browser.newContext();
    const participantContext = await browser.newContext();
    const dashboardPage = await dashboardContext.newPage();
    const participantPage = await participantContext.newPage();
    const browserErrors: string[] = [];

    observeBrowserErrors(dashboardPage, browserErrors);
    observeBrowserErrors(participantPage, browserErrors);

    try {
      await signInLocalOperator(dashboardPage, fixture);

      const queuePath = `/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`;
      const dashboardQueueApiPath = `/api/dashboard/organizations/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`;
      const participantQueueApiPath = `/api/s/${fixture.publicToken}/queue`;
      const participantRequestsApiPath = `/api/s/${fixture.publicToken}/requests/mine`;
      const dashboardRealtimeConnection = dashboardPage.waitForEvent(
        "websocket",
        {
          predicate: (socket) =>
            new URL(socket.url()).pathname === "/realtime/v1/websocket",
        },
      );

      await dashboardPage.goto(queuePath);
      await expect(
        dashboardPage.locator('[data-realtime-status="live"]'),
      ).toBeVisible();
      await dashboardRealtimeConnection;
      await dashboardPage.waitForTimeout(500);

      await participantPage.goto(`/s/${fixture.publicToken}`);
      await participantPage
        .getByLabel("Imię lub ksywka")
        .fill("E2E Realtime Participant");
      const participantRealtimeConnection = participantPage.waitForEvent(
        "websocket",
        {
          predicate: (socket) =>
            new URL(socket.url()).pathname === "/realtime/v1/websocket",
        },
      );
      await participantPage
        .getByRole("button", { name: "Dołącz" })
        .click();
      await participantRealtimeConnection;
      await participantPage.waitForTimeout(500);

      const dashboardRealtimeRefetch = dashboardPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === dashboardQueueApiPath &&
          response.request().method() === "GET" &&
          response.status() === 200,
      );
      await submitParticipantSong(participantPage, "E2E Song");
      await dashboardRealtimeRefetch;

      const participantQueueRow = queueLane(dashboardPage, "pending")
        .locator("[data-queue-request-id]")
        .filter({ hasText: "E2E Realtime Participant" })
        .filter({ hasText: "E2E Song" });
      const participantDashboardQueueRow = dashboardPage
        .locator("[data-queue-request-id]")
        .filter({ hasText: "E2E Realtime Participant" })
        .filter({ hasText: "E2E Song" });
      await expect(participantQueueRow).toBeVisible();

      const participantRealtimeRefetch = participantPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === participantRequestsApiPath &&
          response.request().method() === "GET" &&
          response.status() === 200,
      );
      await participantQueueRow
        .getByRole("button", { name: "Zaakceptuj" })
        .click();
      await participantRealtimeRefetch;

      const participantRequest = participantRequestsSection(participantPage)
        .locator("[data-participant-request-id]")
        .filter({ hasText: "E2E Song" });
      await expect(participantRequest.getByText("Zaakceptowane")).toBeVisible();
      await participantPage.getByRole("tab", { name: /^Kolejka/ }).click();
      const visibleQueue = participantPage.locator(
        'aside[aria-label="Kolejka sesji"]:visible',
      );
      const participantPublicQueueRow = visibleQueue
        .locator("article")
        .filter({ hasText: "E2E Realtime Participant" })
        .filter({ hasText: "E2E Song" });
      await expect(participantPublicQueueRow).toContainText("E2E Song");
      await expect(participantPublicQueueRow).toContainText(
        "Śpiewa: E2E Realtime Participant",
      );
      await expect(participantPublicQueueRow.getByText("Twoje")).toBeVisible();

      const participantQueueRealtimeRefetch = participantPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === participantQueueApiPath &&
          response.request().method() === "GET" &&
          response.status() === 200,
      );
      await participantDashboardQueueRow
        .getByRole("button", { name: "Rozpocznij występ" })
        .click();
      await participantQueueRealtimeRefetch;

      const currentSong = visibleQueue.getByRole("region", {
        name: "Aktualnie wykonywany utwór",
      });
      await expect(currentSong).toContainText("E2E Song");
      await expect(currentSong).toContainText("E2E Artist");
      await expect(currentSong).toContainText(
        "Śpiewa: E2E Realtime Participant",
      );
      expect(browserErrors).toEqual([]);
    } finally {
      await Promise.allSettled([
        participantContext.close(),
        dashboardContext.close(),
      ]);
    }
  });

  test("lets a participant discover a song and submit it without knowing its title", async ({
    browser,
  }) => {
    const dashboardContext = await browser.newContext();
    const participantContext = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": "203.0.113.42" },
    });
    const dashboardPage = await dashboardContext.newPage();
    const participantPage = await participantContext.newPage();
    const browserErrors: string[] = [];

    observeBrowserErrors(dashboardPage, browserErrors);
    observeBrowserErrors(participantPage, browserErrors);

    try {
      await signInLocalOperator(dashboardPage, fixture);
      const dashboardQueuePath = `/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`;
      const dashboardQueueApiPath = `/api/dashboard/organizations/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`;
      const dashboardRealtimeConnection = dashboardPage.waitForEvent(
        "websocket",
        {
          predicate: (socket) =>
            new URL(socket.url()).pathname === "/realtime/v1/websocket",
        },
      );

      await dashboardPage.goto(dashboardQueuePath);
      await expect(
        dashboardPage.locator('[data-realtime-status="live"]'),
      ).toBeVisible();
      await dashboardRealtimeConnection;
      await dashboardPage.waitForTimeout(500);

      await participantPage.goto(`/s/${fixture.publicToken}`);
      await participantPage
        .getByLabel("Imię lub ksywka")
        .fill("E2E Discovery User");
      await participantPage
        .getByRole("button", { name: "Dołącz" })
        .click();
      await expectParticipantProfileControl(participantPage);
      await expect(
        participantPage.getByRole("link", {
          name: "Zobacz wszystkie gatunki",
        }),
      ).toBeVisible();

      await participantPage
        .getByRole("link", { name: "Zobacz wszystkie gatunki" })
        .click();
      await expect(
        participantPage.getByRole("heading", { name: "Gatunki" }),
      ).toBeVisible();
      await expect(participantPage).toHaveURL(
        new RegExp(`/s/${escapeRegExp(fixture.publicToken)}/catalog/genres$`),
      );
      await participantPage.goBack();

      const searchbox = participantPage.getByRole("searchbox");
      await searchbox.fill("E2E Discovery Hit");
      await expect(
        participantPage.getByRole("heading", { name: "„E2E Discovery Hit”" }),
      ).toBeVisible();
      const discoveredSong = participantPage.getByRole("button", {
        name: /E2E Discovery Hit/,
      });
      await expect(discoveredSong).toBeVisible();

      const dashboardRealtimeRefetch = dashboardPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === dashboardQueueApiPath &&
          response.request().method() === "GET" &&
          response.status() === 200,
      );
      await discoveredSong.click();
      await participantPage
        .getByRole("button", { name: "Dodaj do kolejki" })
        .click();
      await dashboardRealtimeRefetch;

      await expect(
        queueLane(dashboardPage, "pending")
          .locator("[data-queue-request-id]")
          .filter({ hasText: "E2E Discovery User" })
          .filter({ hasText: "E2E Discovery Hit" }),
      ).toBeVisible();

      await participantPage.getByRole("tab", { name: /Moje/ }).click();
      await expect(
        participantPage
          .locator("[data-participant-request-id]")
          .filter({ hasText: "E2E Discovery Hit" }),
      ).toBeVisible();
      expect(browserErrors).toEqual([]);
    } finally {
      await Promise.allSettled([
        participantContext.close(),
        dashboardContext.close(),
      ]);
    }
  });

  test("keeps the real session catalog route-driven, paginated, and stateful", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const browserErrors: string[] = [];
    const browseRequests: URL[] = [];
    const searchRequests: URL[] = [];
    let realtimeConnections = 0;

    observeBrowserErrors(page, browserErrors);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === `/api/s/${fixture.publicToken}/songs/browse`) {
        browseRequests.push(url);
      }
      if (url.pathname === `/api/s/${fixture.publicToken}/songs/search`) {
        searchRequests.push(url);
      }
    });
    page.on("websocket", (socket) => {
      if (new URL(socket.url()).pathname === "/realtime/v1/websocket") {
        realtimeConnections += 1;
      }
    });

    const sessionPath = `/s/${fixture.publicToken}`;
    const rockPath = `${sessionPath}/catalog?filter=genre%3Arock`;
    const participantName = "E2E UI5 Participant";

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(sessionPath);
      await expect.poll(() => fixture.readParticipantRequests(participantName)).toEqual([]);
      await page.getByLabel("Imię lub ksywka").fill(participantName);
      await page.getByRole("button", { name: "Dołącz" }).click();
      await expectParticipantProfileControl(page);
      await expect.poll(() => fixture.readParticipantRequests(participantName)).toEqual([]);
      await submitParticipantSong(page, "E2E Song");
      await expect
        .poll(() => fixture.readParticipantRequests(participantName))
        .toEqual([
          expect.objectContaining({
            songTitle: "E2E Song",
            requestedBy: "public",
            requestDisplayName: participantName,
            currentDisplayName: participantName,
            createdAt: expect.any(Date),
          }),
        ]);
      await expect(page.locator("aside[aria-label=\"Kolejka sesji\"]")).toBeVisible();

      await expectDiscoveryRoute(page, sessionPath, "198.18.0.1");
      const catalogRoutes = [
        [`${sessionPath}/catalog/genres`, "Gatunki"],
        [rockPath, "Rock"],
        [`${sessionPath}/catalog?filter=hits`, "Hity"],
        [`${sessionPath}/catalog?filter=newest`, "Najnowsze"],
        [`${sessionPath}/catalog?filter=duets`, "Duety"],
        [`${sessionPath}/catalog?filter=genre%3Arock%20%26%20roll`, "rock & roll"],
      ] as const;
      for (const [index, [path, heading]] of catalogRoutes.entries()) {
        await expectCatalogRoute(page, path, heading, `198.18.0.${index + 2}`);
      }

      await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.18.1.1" });

      await page.goto(sessionPath);
      await page.getByRole("link", { name: "Zobacz wszystkie gatunki" }).click();
      await expect(page).toHaveURL(`${sessionPath}/catalog/genres`);
      await page.getByRole("link", { name: `Rock, ${LOCAL_E2E_ROCK_SONG_COUNT} piosenek` }).click();
      await expect(page).toHaveURL(`${sessionPath}/catalog?filter=genre%3Arock`);
      await page.goBack();
      await expect(page).toHaveURL(`${sessionPath}/catalog/genres`);
      await expect(page.getByRole("heading", { name: "Gatunki" })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(sessionPath);
      await expect(page.getByRole("link", { name: "Zobacz wszystkie gatunki" })).toBeVisible();

      await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.18.1.2" });
      await page.goto(rockPath);
      await page.getByRole("button", { name: "Wróć do gatunków" }).click();
      await expect(page).toHaveURL(`${sessionPath}/catalog/genres`);

      browseRequests.length = 0;
      await page.goto(`${sessionPath}/catalog?genre=Rock`);
      await expect(page).toHaveURL(`${sessionPath}/catalog?filter=genre%3Arock`);
      await expect(page.getByRole("heading", { name: "Rock", exact: true })).toBeVisible();
      await expect.poll(() => browseRequests.length).toBe(1);

      browseRequests.length = 0;
      await page.goto(`${sessionPath}/catalog?sort=newest`);
      await expect(page).toHaveURL(`${sessionPath}/catalog?filter=newest`);
      await expect(page.getByRole("heading", { name: "Najnowsze", exact: true })).toBeVisible();
      await expect.poll(() => browseRequests.length).toBe(1);

      browseRequests.length = 0;
      await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.18.1.3" });
      await page.goto(rockPath);
      const catalogRows = page.locator('section[aria-labelledby="catalog-song-list-heading"] li');
      await expect(catalogRows).toHaveCount(24);
      await expect.poll(() => browseRequests.length).toBe(1);
      const loadMore = page.getByRole("button", { name: "Załaduj więcej" });
      await loadMore.scrollIntoViewIfNeeded();
      const main = page.getByRole("main");
      const scrollBeforeLoadMore = await main.evaluate((node) => node.scrollTop);
      await loadMore.click();
      await expect(catalogRows).toHaveCount(LOCAL_E2E_ROCK_SONG_COUNT);
      expect(new Set(await catalogRows.allTextContents()).size).toBe(LOCAL_E2E_ROCK_SONG_COUNT);
      expect(browseRequests).toHaveLength(2);
      expect(browseRequests.filter((url) => url.searchParams.has("cursor"))).toHaveLength(1);
      expect(await main.evaluate((node) => node.scrollTop)).toBeGreaterThanOrEqual(scrollBeforeLoadMore - 1);
      await expect(loadMore).toHaveCount(0);

      const catalogScrollPosition = await main.evaluate((node) => {
        node.scrollTo({ top: 680 });
        return node.scrollTop;
      });
      searchRequests.length = 0;
      const searchbox = page.getByRole("searchbox");
      await searchbox.fill("a");
      await page.waitForTimeout(300);
      expect(searchRequests).toHaveLength(0);
      await searchbox.fill("");
      await searchbox.pressSequentially("dancing queen", { delay: 10 });
      await expect(page.getByRole("heading", { name: "„dancing queen”" })).toBeVisible();
      await expect.poll(() => searchRequests.length).toBe(1);
      expect(searchRequests[0]?.searchParams.get("q")).toBe("dancing queen");

      await searchbox.fill("abba");
      await searchbox.press("Enter");
      await expect(page.getByRole("heading", { name: "„abba”" })).toBeVisible();
      await expect.poll(() => searchRequests.length).toBe(2);
      expect(searchRequests[1]?.searchParams.get("q")).toBe("abba");
      await page.getByRole("button", { name: "Wróć do katalogu" }).click();
      await expect(page.getByRole("heading", { name: "Rock", exact: true })).toBeVisible();
      await expect(catalogRows).toHaveCount(LOCAL_E2E_ROCK_SONG_COUNT);
      expect(await main.evaluate((node) => node.scrollTop)).toBeGreaterThanOrEqual(catalogScrollPosition - 1);
      expect(browseRequests).toHaveLength(2);

      const browserRequestCountBeforeTabs = browseRequests.length;
      const searchRequestCountBeforeTabs = searchRequests.length;
      const realtimeConnectionsBeforeTabs = realtimeConnections;
      await page.getByRole("tab", { name: /^Kolejka/ }).click();
      await expect(page.locator("aside").getByRole("tab", { name: /^Moje/ })).toBeVisible();
      await expect.poll(() => fixture.readParticipantRequests(participantName)).toHaveLength(1);
      await page.getByRole("tab", { name: /^Moje/ }).click();
      await expect(
        participantRequestsSection(page)
          .locator("[data-participant-request-id]")
          .filter({ hasText: "E2E Song" }),
      ).toHaveCount(1);
      await page.getByRole("tab", { name: /^Kolejka/ }).click();
      expect(browseRequests).toHaveLength(browserRequestCountBeforeTabs);
      expect(searchRequests).toHaveLength(searchRequestCountBeforeTabs);
      expect(realtimeConnections).toBe(realtimeConnectionsBeforeTabs);

      await page.getByRole("button", { name: /E2E Rock Song with an intentionally long title/ }).click();
      await expect(
        page
          .getByRole("dialog")
          .getByText("E2E Rock Song with an intentionally long title for drawer overflow verification"),
      ).toBeVisible();
      await page.getByRole("button", { name: "Zamknij szczegóły utworu" }).click();
      await expect(catalogRows).toHaveCount(LOCAL_E2E_ROCK_SONG_COUNT);

      const desktopScroll = await page.evaluate(() => ({
        bodyScrollHeight: document.scrollingElement?.scrollHeight ?? 0,
        viewportHeight: window.innerHeight,
        leftOverflow: getComputedStyle(document.querySelector("main")!).overflowY,
        rightOverflow: getComputedStyle(document.querySelector("aside .session-scrollbar")!).overflowY,
      }));
      expect(desktopScroll.bodyScrollHeight).toBeLessThanOrEqual(desktopScroll.viewportHeight + 1);
      expect(desktopScroll.leftOverflow).toBe("auto");
      expect(desktopScroll.rightOverflow).toBe("auto");

      await page.setViewportSize({ width: 390, height: 844 });
      const mobileQueueTrigger = page.locator(
        '[data-slot="drawer-trigger"][aria-label="Otwórz kolejkę"]',
      );
      await expect(mobileQueueTrigger).toBeVisible();
      await mobileQueueTrigger.click();
      await expect(page.getByRole("tab", { name: /^Moje/ })).toBeVisible();
      await page.getByRole("tab", { name: /^Moje/ }).click();
      await expect(
        participantRequestsSection(page)
          .locator("[data-participant-request-id]")
          .filter({ hasText: "E2E Song" }),
      ).toHaveCount(1);
      await page.getByRole("button", { name: "Zwiń kolejkę" }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      await page.setViewportSize({ width: 1440, height: 900 });
      searchRequests.length = 0;
      await page.goto(`${sessionPath}/search?q=abba`);
      await expect(page).toHaveURL(`${sessionPath}/search?q=abba`);
      await expect(page.getByRole("searchbox")).toHaveValue("abba");
      await expect(page.getByRole("heading", { name: "„abba”" })).toBeVisible();
      await expect.poll(() => searchRequests.length).toBe(1);
      await page.reload();
      await expect(page.getByRole("searchbox")).toHaveValue("abba");
      await expect(page.getByRole("heading", { name: "„abba”" })).toBeVisible();
      await expect.poll(() => searchRequests.length).toBe(2);
      await page.getByRole("button", { name: "Wróć do katalogu" }).click();
      await expect(page).toHaveURL(sessionPath);

      searchRequests.length = 0;
      await page.goto(`${sessionPath}/search`);
      await expect(page).toHaveURL(sessionPath);
      await expect(searchRequests).toHaveLength(0);
      await page.goto(`${sessionPath}/search?q=a`);
      await expect(page).toHaveURL(sessionPath);
      await expect(searchRequests).toHaveLength(0);
      expect(browserErrors).toEqual([]);
    } finally {
      await context.close();
    }
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
      await signInLocalOperator(page, fixture);

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
        anonymousPage.locator("#participant-join-title"),
      ).toBeVisible();
      await expect(anonymousPage.locator("#participant-join-title")).toHaveText(
        fixture.eventName,
      );
      await expect(
        anonymousPage
          .getByRole("dialog")
          .getByRole("heading", { name: "Jak mamy Cię podpisać?" }),
      ).toBeVisible();
      await expect(anonymousPage.getByRole("searchbox")).toHaveCount(0);

      const participantName = "E2E Participant";
      await anonymousPage.getByLabel("Imię lub ksywka").fill(participantName);
      await anonymousPage
        .getByRole("button", { name: "Dołącz" })
        .click();
      await expect(anonymousPage.getByRole("searchbox")).toBeVisible();
      await expectParticipantProfileControl(anonymousPage);

      await submitParticipantSong(anonymousPage, "E2E Song");
      await expect
        .poll(() => fixture.readParticipantRequests(participantName))
        .toHaveLength(1);
      const [firstParticipantRequest] =
        await fixture.readParticipantRequests(participantName);
      expect(firstParticipantRequest?.songTitle).toBe("E2E Song");

      await anonymousPage.reload();
      await expect(anonymousPage.locator("#participant-join-title")).toHaveCount(0);
      await expectParticipantProfileControl(anonymousPage);

      await openMyRequests(anonymousPage);
      const myRequests = participantRequestsSection(anonymousPage);
      await expect(
        myRequests.locator("[data-participant-request-id]").filter({ hasText: "E2E Song" }),
      ).toBeVisible();

      await page.goto(queuePath);
      const participantQueueRow = queueLane(page, "pending")
        .locator("[data-queue-request-id]")
        .filter({ hasText: participantName })
        .filter({ hasText: "E2E Song" });
      await expect(participantQueueRow).toBeVisible();
      await participantQueueRow.getByRole("button", { name: "Zaakceptuj" }).click();
      await expect
        .poll(async () =>
          (await fixture.readParticipantRequests(participantName))[0]?.status,
        )
        .toBe("approved");
      await expect(
        myRequests
          .locator("[data-participant-request-id]")
          .filter({ hasText: "E2E Song" })
          .getByText("Zaakceptowane"),
      ).toBeVisible();

      const renamedParticipant = "E2E Renamed";
      await openParticipantProfile(anonymousPage);
      await anonymousPage
        .getByLabel("Twój nick")
        .fill(renamedParticipant);
      await anonymousPage.getByRole("button", { name: "Zapisz" }).click();
      await expectParticipantProfileControl(anonymousPage);

      await submitParticipantSong(anonymousPage, "E2E Second Song");
      await expect
        .poll(() => fixture.readParticipantRequests(participantName))
        .toHaveLength(2);
      const participantRequests =
        await fixture.readParticipantRequests(participantName);
      expect(new Set(participantRequests.map(({ participantId }) => participantId)).size).toBe(1);
      expect(
        new Set(
          participantRequests.map(
            ({ eventParticipantId }) => eventParticipantId,
          ),
        ).size,
      ).toBe(1);
      const secondRequest = myRequests
        .locator("[data-participant-request-id]")
        .filter({ hasText: "E2E Second Song" });
      await expect(secondRequest.getByText("Oczekujące")).toBeVisible();
      await secondRequest.getByRole("button", { name: "Anuluj" }).click();
      await anonymousPage
        .getByRole("alertdialog")
        .getByRole("button", { name: "Anuluj zgłoszenie" })
        .click();
      await expect(secondRequest.getByText("Pominięte")).toBeVisible();

      const finalParticipantRequests =
        await fixture.readParticipantRequests(participantName);
      expect(finalParticipantRequests.map(({ status }) => status).sort()).toEqual([
        "approved",
        "skipped",
      ]);
      expect(
        new Set(finalParticipantRequests.map(({ participantId }) => participantId)).size,
      ).toBe(1);
      expect(
        new Set(
          finalParticipantRequests.map(({ eventParticipantId }) => eventParticipantId),
        ).size,
      ).toBe(1);
      expect(
        new Set(finalParticipantRequests.map(({ currentDisplayName }) => currentDisplayName)),
      ).toEqual(new Set([renamedParticipant]));
      expect(
        finalParticipantRequests.find(({ songTitle }) => songTitle === "E2E Song")
          ?.requestDisplayName,
      ).toBe(participantName);
      expect(
        finalParticipantRequests.find(({ songTitle }) => songTitle === "E2E Second Song")
          ?.requestDisplayName,
      ).toBe(renamedParticipant);

      await page.goto(sharePath);
      await expect(
        page.getByRole("heading", { name: fixture.eventName }),
      ).toBeVisible();
      const shareMain = page.locator("#dashboard-main");
      await expect(
        shareMain.getByText("Dostęp do sesji", { exact: true }),
      ).toBeVisible();
      await expect(
        shareMain.getByText(`/s/${fixture.publicToken}`, { exact: false }),
      ).toBeVisible();
      await expect(
        shareMain.getByAltText("Kod QR prowadzący do stałego adresu sesji"),
      ).toBeVisible();

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
        page
          .locator("#dashboard-main")
          .getByRole("heading", { name: "Kolejka operacyjna" }),
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
      await expect(anonymousPage.getByRole("searchbox")).toBeVisible();
      await expect(anonymousPage.locator("#participant-join-title")).toHaveCount(0);
      await expectParticipantProfileControl(anonymousPage);

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

async function expectCatalogRoute(
  page: import("@playwright/test").Page,
  path: string,
  heading: string,
  clientIp: string,
) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": clientIp });
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.locator('aside[aria-label="Kolejka sesji"]')).toBeVisible();
  const refreshResponse = await page.reload();
  expect(refreshResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.locator('aside[aria-label="Kolejka sesji"]')).toBeVisible();
}

async function expectDiscoveryRoute(
  page: import("@playwright/test").Page,
  path: string,
  clientIp: string,
) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": clientIp });
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("link", { name: "Zobacz wszystkie gatunki" })).toBeVisible();
  await expect(page.locator('aside[aria-label="Kolejka sesji"]')).toBeVisible();
  const refreshResponse = await page.reload();
  expect(refreshResponse?.status()).toBe(200);
  await expect(page.getByRole("link", { name: "Zobacz wszystkie gatunki" })).toBeVisible();
  await expect(page.locator('aside[aria-label="Kolejka sesji"]')).toBeVisible();
}

async function submitParticipantSong(
  page: import("@playwright/test").Page,
  title: string,
) {
  const search = page.getByRole("searchbox");
  await search.fill(title);
  await expect(page.getByRole("heading", { name: `„${title}”` })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await page.getByRole("button", { name: "Dodaj do kolejki" }).click();
  await openMyRequests(page);
  await expect(
    participantRequestsSection(page)
      .locator("[data-participant-request-id]")
      .filter({ hasText: title }),
  ).toBeVisible();
}

async function openMyRequests(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: /^Moje/ }).click();
}

async function expectParticipantProfileControl(page: import("@playwright/test").Page) {
  await expect(page.getByRole("button", { name: "Zmień swój nick" })).toBeVisible();
}

async function openParticipantProfile(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Zmień swój nick" }).click();
  await expect(page.getByLabel("Twój nick")).toBeVisible();
}

function participantRequestsSection(page: import("@playwright/test").Page) {
  return page.locator('section[aria-labelledby="participant-requests-heading"]:visible');
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

async function signInLocalOperator(
  page: import("@playwright/test").Page,
  fixture: LocalSupabaseFixture,
) {
  await page.goto("/sign-in");
  await page.getByLabel("E-mail").fill(fixture.email);
  await page.getByLabel("Hasło").fill(fixture.password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
  await page.waitForLoadState("networkidle");
}

function queueLane(
  page: import("@playwright/test").Page,
  lane: "pending" | "approved" | "rejected",
) {
  return page.locator(`[data-queue-lane="${lane}"]:visible`);
}

function queueRequest(
  page: import("@playwright/test").Page,
  lane: "pending" | "approved" | "rejected",
  requestName: string,
) {
  return queueLane(page, lane)
    .locator("[data-queue-request-id]")
    .filter({ hasText: requestName });
}

async function queueRequestNamesInLane(
  lane: import("@playwright/test").Locator,
) {
  return lane.locator("[data-queue-request-id] strong").allTextContents();
}

async function dragQueueRequest({
  page,
  sourceLane,
  requestName,
  targetLane,
  targetRequestName,
  cancel = false,
  verifyGeometry = false,
  verifyAutoScroll = false,
}: {
  page: import("@playwright/test").Page;
  sourceLane: "pending" | "approved" | "rejected";
  requestName: string;
  targetLane: "pending" | "approved" | "rejected";
  targetRequestName?: string;
  cancel?: boolean;
  verifyGeometry?: boolean;
  verifyAutoScroll?: boolean;
}) {
  const source = queueRequest(page, sourceLane, requestName);
  const handle = source.getByRole("button", {
    name: new RegExp(`^Przeciągnij zgłoszenie: ${escapeRegExp(requestName)}`),
  });
  const target = targetRequestName
    ? queueRequest(page, targetLane, targetRequestName)
    : queueLane(page, targetLane);

  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  await source.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const handleBox = await handle.boundingBox();
  let targetBox = await target.boundingBox();

  if (!sourceBox || !handleBox || !targetBox) {
    throw new Error("Queue DnD geometry is unavailable.");
  }

  const grabPoint = {
    x: handleBox.x + handleBox.width / 2,
    y: handleBox.y + handleBox.height / 2,
  };
  const grabOffset = {
    x: grabPoint.x - sourceBox.x,
    y: grabPoint.y - sourceBox.y,
  };
  const scrollTopBeforeDrag = verifyAutoScroll
    ? await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)
    : null;
  const viewportBeforeDrag = page.viewportSize();

  if (verifyAutoScroll) {
    if (!viewportBeforeDrag) {
      throw new Error("Queue DnD viewport geometry is unavailable.");
    }
    expect(
      targetBox.y + targetBox.height <= 0 ||
        targetBox.y >= viewportBeforeDrag.height,
    ).toBe(true);
  }

  await page.mouse.move(grabPoint.x, grabPoint.y);
  await page.mouse.down();
  const activationPoint = { x: grabPoint.x + 12, y: grabPoint.y + 8 };
  await page.mouse.move(activationPoint.x, activationPoint.y, { steps: 3 });

  const overlay = page.locator("[data-queue-drag-overlay]");
  await expect(overlay).toBeVisible();

  if (verifyGeometry) {
    const overlayBox = await overlay.boundingBox();
    if (!overlayBox) {
      throw new Error("Queue DragOverlay geometry is unavailable.");
    }

    expect(Math.abs(overlayBox.width - sourceBox.width)).toBeLessThan(2);
    expect(Math.abs(overlayBox.height - sourceBox.height)).toBeLessThan(2);
    expect(Math.abs(activationPoint.x - overlayBox.x - grabOffset.x)).toBeLessThan(
      3,
    );
    expect(Math.abs(activationPoint.y - overlayBox.y - grabOffset.y)).toBeLessThan(
      3,
    );
  }

  if (cancel) {
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    return;
  }

  const viewport = page.viewportSize();
  if (viewport) {
    const maxScrollAttempts = verifyAutoScroll ? 30 : 12;
    for (let attempt = 0; attempt < maxScrollAttempts; attempt += 1) {
      targetBox = await target.boundingBox();
      const targetDropY = targetBox
        ? targetBox.y + Math.min(targetBox.height / 2, 120)
        : null;
      if (
        targetBox &&
        targetDropY !== null &&
        targetDropY >= 8 &&
        targetDropY <= viewport.height - 8
      ) {
        break;
      }

      await page.mouse.move(
        grabPoint.x,
        targetBox && targetBox.y < 0 ? 8 : viewport.height - 8,
        { steps: 4 },
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    }
  }

  if (verifyAutoScroll) {
    const scrollTopAfterDrag = await page.evaluate(
      () => document.scrollingElement?.scrollTop ?? 0,
    );
    expect(Math.abs(scrollTopAfterDrag - (scrollTopBeforeDrag ?? 0))).toBeGreaterThan(
      1,
    );
  }

  targetBox = await target.boundingBox();
  if (!targetBox) {
    throw new Error("Queue DnD target geometry is unavailable after scroll.");
  }

  const targetPoint = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + Math.min(targetBox.height / 2, 120),
  };
  await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 12 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  if (verifyGeometry) {
    const targetOverlayBox = await overlay.boundingBox();
    if (!targetOverlayBox) {
      throw new Error("Queue DragOverlay target geometry is unavailable.");
    }

    expect(Math.abs(targetOverlayBox.width - sourceBox.width)).toBeLessThan(2);
    expect(Math.abs(targetOverlayBox.height - sourceBox.height)).toBeLessThan(2);
    expect(Math.abs(targetPoint.x - targetOverlayBox.x - grabOffset.x)).toBeLessThan(
      3,
    );
    expect(Math.abs(targetPoint.y - targetOverlayBox.y - grabOffset.y)).toBeLessThan(
      3,
    );
  }

  await page.mouse.up();
  await expect(overlay).toHaveCount(0);
}

async function expectQueueStatus(
  fixture: LocalSupabaseFixture,
  requestName: string,
  expectedStatus: string,
) {
  await expect
    .poll(async () => (await fixture.readQueueStatuses())[requestName])
    .toBe(expectedStatus);
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
