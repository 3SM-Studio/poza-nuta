import { expect, test } from "@playwright/test";

import {
  createLocalSupabaseFixture,
  LOCAL_E2E_ROCK_SONG_COUNT,
  type LocalSupabaseFixture,
} from "./local-supabase-fixture";

test.describe.configure({ mode: "serial" });

test.describe("Fair Queue with local Supabase Auth", () => {
  let fixture: LocalSupabaseFixture;

  test.setTimeout(240_000);

  test.beforeAll(async () => {
    fixture = await createLocalSupabaseFixture();
  });

  test.afterAll(async () => {
    await fixture?.cleanup();
  });

  test("Fair Queue karaoke preserves manual decisions, previews, rejects stale state and synchronizes Realtime on desktop and mobile", async ({ browser }) => {
    await fixture.resetQueue();
    const contexts = await Promise.all([41, 42, 43, 44, 45].map(ip => browser.newContext({
      viewport: { width: 1440, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${ip}` },
    })));
    const [dashboardContext, ac, bc, cc, dc] = contexts;
    const dashboard = await dashboardContext.newPage(), a = await ac.newPage(), b = await bc.newPage(), c = await cc.newPage(), d = await dc.newPage();
    const eventPath = `/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`;
    const apiPath = `/api/dashboard/organizations/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`;
    const errors: string[] = [];
    for (const page of [dashboard, a, b, c, d]) observeBrowserErrors(page, errors, new Set([`${apiPath}/fair`]));
    const join = async (page: typeof a, name: string) => {
      await page.goto(`/join/${fixture.sessionCode}`);
      await page.getByLabel("Imię lub ksywka").fill(name);
      await page.getByRole("button", { name: "Dołącz", exact: true }).click();
      await expectParticipantProfileControl(page);
    };
    const requestRow = (name: string, title: string) => dashboard.locator("[data-queue-request-id]").filter({ hasText: name }).filter({ hasText: title });
    const action = async (name: string, title: string, label: string) => {
      const saved = dashboard.waitForResponse(response => new URL(response.url()).pathname.startsWith(apiPath) &&
        new URL(response.url()).pathname.endsWith("/action") && response.request().method() === "POST" && response.status() === 200);
      await requestRow(name, title).getByRole("button", { name: new RegExp(`^${label}`) }).click();
      await saved;
      await expect(dashboard.getByText("Trwa zapis…", { exact: true })).toHaveCount(0);
    };
    const fairNames = async () => (await queueRequestNamesInLane(queueLane(dashboard, "approved"))).filter(name => name.startsWith("Fair E2E"));
    try {
      await signInLocalOperator(dashboard, fixture); await dashboard.goto(eventPath);
      await expect(dashboard.locator('[data-realtime-status="live"]')).toBeVisible();
      // Complete the unrelated legacy fixture using the normal operator UI.
      await queueRequest(dashboard, "approved", fixture.queueRequestNames.approved).getByRole("button", { name: /^Oznacz jako zagrane/ }).click();
      await expect(queueLane(dashboard, "approved").locator("[data-queue-request-id]")).toHaveCount(0);
      await join(a, "Fair E2E A"); await join(b, "Fair E2E B"); await join(c, "Fair E2E C");
      for (const [page, name, repeats] of [[a, "Fair E2E A", 2], [b, "Fair E2E B", 1]] as const) {
        for (let i = 0; i < repeats; i++) {
          await submitParticipantSong(page, "E2E Song");
          await action(name, "E2E Song", "Zaakceptuj");
          await action(name, "E2E Song", "Rozpocznij występ");
          await action(name, "E2E Song", "Oznacz jako zagrane");
        }
      }
      await submitParticipantSong(a, "E2E Song"); await action("Fair E2E A", "E2E Song", "Zaakceptuj");
      await submitParticipantSong(a, "E2E Second Song"); await action("Fair E2E A", "E2E Second Song", "Zaakceptuj");
      await submitParticipantSong(b, "E2E Song"); await action("Fair E2E B", "E2E Song", "Zaakceptuj");
      await submitParticipantSong(c, "E2E Song"); await action("Fair E2E C", "E2E Song", "Zaakceptuj");
      await expect.poll(fairNames).toEqual(["Fair E2E C", "Fair E2E A", "Fair E2E B", "Fair E2E A"]);
      // Use the shared scroll-aware pointer helper; A has two distinct songs.
      await dashboard.setViewportSize({ width: 1440, height: 1800 });
      const moved = dashboard.waitForResponse(response => new URL(response.url()).pathname.startsWith(apiPath) && new URL(response.url()).pathname.endsWith("/placement") && response.status() === 200);
      await dragQueueRequest({ page: dashboard, sourceLane: "approved", requestName: "Fair E2E A",
        requestTitle: "E2E Second Song", targetLane: "approved", targetRequestName: "Fair E2E C" });
      await moved;
      await expect.poll(async () => queueLane(dashboard, "approved").locator("[data-queue-request-id]").first().textContent()).toContain("E2E Second Song");
      await dashboard.setViewportSize({ width: 1440, height: 1100 });
      const manuallyOrdered = (await fixture.readQueueRows()).filter(row => row.status === "approved").sort((x, y) => x.position - y.position).map(row => row.requestId);
      await join(d, "Fair E2E D"); await submitParticipantSong(d, "E2E Song"); await action("Fair E2E D", "E2E Song", "Zaakceptuj");
      const afterInsert = (await fixture.readQueueRows()).filter(row => row.status === "approved").sort((x, y) => x.position - y.position);
      expect(afterInsert.filter(row => row.displayName !== "Fair E2E D").map(row => row.requestId)).toEqual(manuallyOrdered);
      await dashboard.getByRole("button", { name: "Ułóż sprawiedliwie", exact: true }).click();
      const dialog = dashboard.getByRole("dialog", { name: "Ułóż sprawiedliwie", exact: true });
      await expect(dialog.getByRole("list", { name: "Proponowana kolejność" }).locator("li")).toHaveCount(5);
      await dialog.getByRole("button", { name: "Anuluj" }).click();
      expect((await fixture.readQueueRows()).filter(row => row.status === "approved").sort((x, y) => x.position - y.position).map(row => row.requestId)).toEqual(afterInsert.map(row => row.requestId));
      await dashboard.setViewportSize({ width: 390, height: 844 });
      await dashboard.getByRole("button", { name: "Ułóż sprawiedliwie", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Zastosuj kolejność" })).toBeEnabled();
      expect(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // A real concurrent operator write invalidates the displayed revision.
      const concurrent = await dashboardContext.request.post(`${apiPath}/requests/${afterInsert[0].requestId}/move`, {
        headers: { origin: new URL(dashboard.url()).origin }, data: { targetPosition: 5 },
      });
      expect(concurrent.status()).toBe(200);
      await dialog.getByRole("button", { name: "Zastosuj kolejność" }).click();
      await expect(dialog.getByRole("alert")).toContainText("Kolejka zmieniła się od podglądu");
      await dialog.getByRole("button", { name: "Odśwież podgląd" }).click();
      await expect(dialog.locator("[data-fair-request-id]")).toHaveCount(5);
      const proposedIds = await dialog.locator("[data-fair-request-id]").evaluateAll(nodes => nodes.map(node => Number(node.getAttribute("data-fair-request-id"))));
      await c.getByRole("tab", { name: /^Kolejka/ }).click();
      const publicQueue = c.locator('aside[aria-label="Kolejka sesji"]:visible');
      const publicNames = async () => (await publicQueue.locator("article").allTextContents()).map(text => text.match(/Fair E2E [A-D]/)?.[0]);
      const beforeSortNames = (await fixture.readQueueRows()).filter(row => row.status === "approved").sort((x, y) => x.position - y.position).map(row => row.displayName);
      await expect.poll(publicNames).toEqual(beforeSortNames);
      const refetch = c.waitForResponse(response => new URL(response.url()).pathname === `/api/s/${fixture.publicToken}/queue` && response.status() === 200);
      const started = Date.now();
      await dialog.getByRole("button", { name: "Zastosuj kolejność" }).click(); await refetch;
      await expect(dialog).toHaveCount(0);
      const persisted = () => fixture.readQueueRows().then(rows => rows.filter(row => row.status === "approved").sort((x, y) => x.position - y.position).map(row => Number(row.requestId)));
      await expect.poll(persisted).toEqual(proposedIds);
      await expect.poll(fairNames).toEqual(["Fair E2E C", "Fair E2E D", "Fair E2E B", "Fair E2E A", "Fair E2E A"]);
      await expect.poll(() => publicQueue.locator("article").allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining("Fair E2E C")]));
      await expect.poll(publicNames).toEqual(["Fair E2E C", "Fair E2E D", "Fair E2E B", "Fair E2E A", "Fair E2E A"]);
      console.log(`[fair-queue] Realtime apply-to-public refetch: ${Date.now() - started} ms`);
      await dashboard.setViewportSize({ width: 1440, height: 1100 });
      await action("Fair E2E C", "E2E Song", "Rozpocznij występ");
      await action("Fair E2E C", "E2E Song", "Oznacz jako zagrane");
      await submitParticipantSong(c, "E2E Second Song"); await action("Fair E2E C", "E2E Second Song", "Zaakceptuj");
      expect((await fairNames())[0]).toBe("Fair E2E D");
      // Expected 409 was already asserted; no unrelated browser/runtime error.
      expect(errors).toEqual([]);
      const beforeConnectionFailure = await fixture.readQueueRows();
      await dashboard.route("**/queue/fair", route => route.abort("connectionreset"), { times: 1 });
      await dashboard.getByRole("button", { name: "Ułóż sprawiedliwie", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("Nie udało się pobrać podglądu");
      await expect(dialog.getByRole("button", { name: "Zastosuj kolejność" })).toHaveCount(0);
      expect(await fixture.readQueueRows()).toEqual(beforeConnectionFailure);
      await dialog.getByRole("button", { name: "Odśwież podgląd" }).click();
      await expect(dialog.locator("[data-fair-request-id]")).toHaveCount(5);
      await dialog.getByRole("button", { name: "Anuluj" }).click();
      expect(await fixture.readQueueRows()).toEqual(beforeConnectionFailure);
      expect(errors).toEqual(["Failed to load resource: net::ERR_CONNECTION_RESET"]);
    } finally { await Promise.all(contexts.map(context => context.close())); }
  });
});

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
      requestName: orderBefore.at(-1)!,
      targetLane: "approved",
      targetRequestName: orderBefore[0],
    });
    await expect
      .poll(() => queueRequestNamesInLane(approvedLane))
      .not.toEqual(orderBefore);
    expect(await queueRequestNamesInLane(approvedLane)).toEqual([...orderBefore].reverse());
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
    await liftQueueKeyboard(page, keyboardReorderHandle);
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
    await liftQueueKeyboard(page, keyboardHandle);
    const rejectedDropStatus = page.locator("[data-queue-drop-feedback]");
    await page.keyboard.press("ArrowDown");
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(rejectedDropStatus).toContainText("wymagane potwierdzenie");
    await page.keyboard.press("Space");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: "Odrzuć zgłoszenie", exact: true }).click();
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
    await liftQueueKeyboard(page, keyboardCancelHandle);
    await page.keyboard.press("Escape");
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

  test("links devices and claims manual and existing profiles with explicit confirmations", async ({ browser }) => {
    const contexts = await Promise.all([89, 90, 91, 92].map(n => browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${n}` }, viewport: { width: n === 91 ? 390 : 1440, height: n === 91 ? 844 : 1100 } })));
    const [dashboardContext, ownerContext, deviceContext, otherContext] = contexts;
    const dashboard = await dashboardContext.newPage(), owner = await ownerContext.newPage(), device = await deviceContext.newPage(), other = await otherContext.newPage();
    const queue = await dashboardContext.newPage();
    const eventPath = `/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}`;
    const sessionPath = `/s/${fixture.publicToken}`;
    const errors: string[] = [];
    for (const page of [dashboard, owner, other, queue]) observeBrowserErrors(page, errors);
    const deviceErrors: string[] = [];
    observeBrowserErrors(device, deviceErrors);
    async function openIdentity(page: typeof owner) {
      await page.getByRole("button", { name: "Zmień swój nick", exact: true }).click();
      await page.getByRole("button", { name: "Urządzenia i łączenie profili" }).click();
      return page.getByRole("dialog", { name: "Urządzenia i profile", exact: true });
    }
    async function closeIdentity(page: typeof owner) {
      await page.getByRole("dialog", { name: "Urządzenia i profile", exact: true }).getByRole("button", { name: "Zamknij", exact: true }).click();
      await page.getByRole("button", { name: "Zamknij zmianę nicku" }).click();
    }
    try {
      await signInLocalOperator(dashboard, fixture);
      await dashboard.goto(`${eventPath}/participants`);
      await owner.goto(`/join/${fixture.sessionCode}`);
      await owner.getByLabel("Imię lub ksywka").fill("Slice Four Owner");
      await owner.getByRole("button", { name: "Dołącz", exact: true }).click();
      await submitParticipantSong(owner, "E2E Song"); await submitParticipantSong(owner, "E2E Second Song");
      const trusted = await openIdentity(owner);
      await trusted.getByRole("button", { name: "Połącz kolejne urządzenie", exact: true }).click();
      const invitation = await trusted.getByLabel("Jednorazowy kod urządzenia").inputValue();
      await device.goto(sessionPath);
      await device.getByRole("button", { name: "Połącz istniejące urządzenie" }).click();
      const receiving = device.getByRole("dialog", { name: "Połącz urządzenie", exact: true });
      await receiving.getByLabel("Jednorazowy kod z zaufanego urządzenia").fill(invitation);
      await receiving.getByRole("button", { name: "Przygotuj połączenie" }).click();
      const code = await receiving.getByLabel("Kod potwierdzenia").textContent();
      await trusted.getByRole("button", { name: "Sprawdź stan połączenia" }).click();
      await trusted.getByLabel("Kod potwierdzenia z drugiego urządzenia").fill(code!);
      await trusted.getByRole("button", { name: "Potwierdź to urządzenie" }).click();
      await expect(trusted.getByText("Potwierdzono. Zakończ łączenie na drugim urządzeniu.")).toBeVisible();
      // Commit on the real server, then sever the HTTP response. The bound
      // receiver must recover the same credential, including if headers arrived.
      await device.route("**/identity/linking", async route => {
        const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
        if (body?.action === "finish") {
          const serverResponse = await route.fetch();
          expect(serverResponse.status()).toBe(200);
          await route.abort("connectionreset");
        } else await route.continue();
      });
      await receiving.getByRole("button", { name: "Zakończ połączenie" }).click();
      await expect(receiving.getByRole("alert")).toContainText("Nie udało się wykonać operacji");
      expect(deviceErrors).toEqual(["Failed to load resource: net::ERR_CONNECTION_RESET"]);
      deviceErrors.length = 0;
      await device.unroute("**/identity/linking");
      await receiving.getByRole("button", { name: "Zakończ połączenie" }).click();
      await expect(device.getByText("Aktywne zgłoszenia: 2/2", { exact: true }).first()).toBeVisible();
      await closeIdentity(owner);
      const cookiesA = await ownerContext.cookies(), cookiesB = await deviceContext.cookies();
      const credentialA = cookiesA.find(cookie => cookie.name === "poza_nuta_participant"), credentialB = cookiesB.find(cookie => cookie.name === "poza_nuta_participant");
      expect(Boolean(credentialA?.httpOnly && credentialB?.httpOnly && credentialA.value !== credentialB.value)).toBe(true);
      expect(await fixture.readParticipantCredentialCount("Slice Four Owner")).toBe(2);
      await expect.poll(async () => (await fixture.readParticipantPresence("Slice Four Owner")).liveConnections).toBe(2);
      await device.reload();
      await expect(device.getByText("Aktywne zgłoszenia: 2/2", { exact: true }).first()).toBeVisible();
      expect(await device.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await dashboard.getByRole("button", { name: "Dodaj uczestnika", exact: true }).click();
      const manualDialog = dashboard.getByRole("dialog", { name: "Dodaj uczestnika", exact: true });
      await manualDialog.getByLabel("Nick uczestnika").fill("Slice Four Manual");
      await manualDialog.getByRole("button", { name: "Utwórz uczestnika" }).click();
      await dashboard.getByRole("button", { name: "Wybierz uczestnika: Slice Four Manual", exact: true }).click();
      await dashboard.getByLabel("Tytuł lub wykonawca", { exact: true }).fill("E2E Discovery Hit");
      await dashboard.getByRole("button", { name: "Szukaj w katalogu" }).click();
      await dashboard.getByRole("radio", { name: "E2E Discovery Hit · E2E Discovery Artist", exact: true }).check();
      await dashboard.getByRole("button", { name: "Dodaj zgłoszenie", exact: true }).click();
      await queue.goto(`${eventPath}/queue`);
      async function perform(name: string, title: string) {
        const row = queue.locator("[data-queue-request-id]").filter({ hasText: name }).filter({ hasText: title });
        for (const label of [/^Zaakceptuj/, /^Rozpocznij/, /^Oznacz jako zagrane/]) {
          const saved = queue.waitForResponse(response => response.request().method() === "POST" &&
            new URL(response.url()).pathname.endsWith("/action"));
          await row.getByRole("button", { name: label }).click();
          expect((await saved).status()).toBe(200);
          await expect(queue.getByText("Trwa zapis…", { exact: true })).toHaveCount(0);
        }
      }
      await perform("Slice Four Manual", "E2E Discovery Hit");
      await dashboard.getByRole("button", { name: "Połącz profile", exact: true }).click();
      const mergeDialog = dashboard.getByRole("dialog", { name: "Połącz profile uczestnika", exact: true });
      const chooseProfiles = async (source: string, target: string) => {
        await mergeDialog.getByLabel("Profil źródłowy (zachowamy historię)").selectOption({ label: source });
        await mergeDialog.getByLabel("Profil docelowy (pozostanie ten nick)").selectOption({ label: target });
        await mergeDialog.getByRole("button", { name: "Utwórz propozycję połączenia" }).click();
      };
      await chooseProfiles("Slice Four Manual · aktywne 0/2", "Slice Four Owner · aktywne 2/2");
      await expect(mergeDialog.getByText("E2E Discovery Hit · E2E Discovery Artist", { exact: true })).toBeVisible();
      await expect(mergeDialog.getByRole("button", { name: "Zatwierdź połączenie profili" })).toBeDisabled();
      const proof = await openIdentity(owner);
      await proof.getByRole("button", { name: "Potwierdzam własność obu profili" }).click();
      await expect(proof.getByText("Zgoda zapisana. Operator może dokończyć połączenie.")).toBeVisible();
      await closeIdentity(owner);
      await mergeDialog.getByRole("button", { name: "Odśwież potwierdzenia" }).click();
      await mergeDialog.getByRole("button", { name: "Zatwierdź połączenie profili" }).click();
      await dashboard.getByRole("alertdialog").getByRole("button", { name: "Wróć bez łączenia" }).click();
      await expect(dashboard.getByRole("alertdialog")).toHaveCount(0);
      await mergeDialog.getByRole("button", { name: "Zatwierdź połączenie profili" }).click();
      await dashboard.getByRole("alertdialog").getByRole("button", { name: "Tak, połącz profile" }).click();
      await expect(mergeDialog.getByText("Profile zostały połączone. Historia i zgłoszenia zachowane.")).toBeVisible();
      await mergeDialog.getByRole("button", { name: "Zamknij", exact: true }).click();
      await expect(dashboard.getByRole("button", { name: "Wybierz uczestnika: Slice Four Manual", exact: true })).toHaveCount(0);
      const retained = await fixture.readParticipantRequests("Slice Four Owner");
      expect(retained.length).toBe(3); expect(retained.filter(row => row.status === "done").length).toBe(1);
      await other.goto(sessionPath); await other.getByLabel("Imię lub ksywka").fill("Slice Four Other"); await other.getByRole("button", { name: "Dołącz", exact: true }).click();
      await submitParticipantSong(other, "E2E Discovery Hit");
      try {
        await expect(dashboard.getByRole("button", { name: "Wybierz uczestnika: Slice Four Other", exact: true })).toContainText("Aktywne: 1/2");
      } catch (error) {
        const diagnostic = await dashboard.evaluate(() => {
          const button = document.querySelector('button[aria-label="Wybierz uczestnika: Slice Four Other"]');
          const panel = document.querySelector('[aria-labelledby="event-participants-title"]');
          return { otherInDom: !!button, hiddenAncestor: !!button?.closest('[aria-hidden="true"]'), panelHidden: !!panel?.closest('[aria-hidden="true"]'),
            bodyPointerEvents: document.body.style.pointerEvents, dialogs: document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length,
            rows: panel?.querySelectorAll('button[aria-label^="Wybierz uczestnika:"]').length,
            filterEmpty: (document.querySelector('#participant-filter') as HTMLInputElement | null)?.value === "" };
        });
        await test.info().attach("participant-list-state", { body: JSON.stringify(diagnostic), contentType: "application/json" });
        throw error;
      }
      await dashboard.getByRole("button", { name: "Połącz profile", exact: true }).click();
      await chooseProfiles("Slice Four Owner · aktywne 2/2", "Slice Four Other · aktywne 1/2");
      await expect(mergeDialog.getByRole("alert")).toContainText("więcej niż 2 aktywne");
      for (const page of [owner, other]) { const dialog = await openIdentity(page); await dialog.getByRole("button", { name: "Potwierdzam własność obu profili" }).click(); await expect(dialog.getByText("Zgoda zapisana. Operator może dokończyć połączenie.")).toBeVisible(); await closeIdentity(page); }
      await mergeDialog.getByRole("button", { name: "Odśwież potwierdzenia" }).click();
      await expect(mergeDialog.getByRole("button", { name: "Zatwierdź połączenie profili" })).toBeDisabled();
      await perform("Slice Four Owner", "E2E Song");
      await mergeDialog.getByRole("button", { name: "Odśwież potwierdzenia" }).click();
      await mergeDialog.getByRole("button", { name: "Zatwierdź połączenie profili" }).click();
      await dashboard.getByRole("alertdialog").getByRole("button", { name: "Tak, połącz profile" }).click();
      await expect(mergeDialog.getByText("Profile zostały połączone. Historia i zgłoszenia zachowane.")).toBeVisible();
      await device.reload();
      await expect(device.getByText("Aktywne zgłoszenia: 2/2", { exact: true }).first()).toBeVisible();
      await expect.poll(async () => (await fixture.readParticipantPresence("Slice Four Other")).liveConnections).toBe(3);
      expect((await fixture.readParticipantRequests("Slice Four Other")).length).toBe(4);
      expect(errors).toEqual([]); expect(deviceErrors).toEqual([]);
    } finally { await Promise.allSettled(contexts.map(context => context.close())); }
  });

  test("tracks participant presence across tabs, TTL without beacon, reconnect and reload", async ({ browser }) => {
    const dashboardContext = await browser.newContext();
    const participantContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const dashboard = await dashboardContext.newPage();
    let participant = await participantContext.newPage();
    const name = "Slice Three Presence";
    const errors: string[] = [];
    observeBrowserErrors(dashboard, errors); observeBrowserErrors(participant, errors);
    try {
      await signInLocalOperator(dashboard, fixture);
      await dashboard.goto(`/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/participants`);
      await expect(dashboard.locator('[data-participants-realtime="live"]')).toBeVisible();
      await participant.goto(`/join/${fixture.sessionCode}`);
      await participant.getByLabel("Imię lub ksywka").fill(name);
      const started = performance.now();
      await participant.getByRole("button", { name: "Dołącz" }).click();
      const row = dashboard.getByRole("button", { name: `Wybierz uczestnika: ${name}`, exact: true });
      await expect(row.locator('[data-participant-presence="online"]')).toBeVisible({ timeout: 5000 });
      console.log(`[presence] QR join online: ${Math.round(performance.now() - started)} ms`);
      await expect(row).toContainText("Aktywne: 0/2");
      const initial = await fixture.readParticipantPresence(name);
      expect(initial.liveConnections).toBe(1);
      expect(await fixture.readParticipantRequests(name)).toEqual([]);
      const second = await participantContext.newPage();
      await second.goto(`/s/${fixture.publicToken}`);
      await expect.poll(async () => (await fixture.readParticipantPresence(name)).liveConnections).toBe(2);
      await participant.close();
      await expect.poll(async () => (await fixture.readParticipantPresence(name)).liveConnections).toBe(1);
      await expect(row.locator('[data-participant-presence="online"]')).toBeVisible();
      await second.reload();
      await expect.poll(async () => (await fixture.readParticipantPresence(name)).liveConnections).toBe(1);
      expect((await fixture.readParticipantPresence(name)).memberId).toBe(initial.memberId);
      await second.close();
      await expect(row.locator('[data-participant-presence="offline"]')).toBeVisible({ timeout: 5000 });

      participant = await participantContext.newPage();
      await participant.goto(`/s/${fixture.publicToken}`);
      await expect(row.locator('[data-participant-presence="online"]')).toBeVisible({ timeout: 5000 });
      // Kill transport only: the page cannot send a heartbeat or a beacon. The
      // dashboard's real deadline timer must ask the server and display offline.
      await participantContext.setOffline(true);
      const lostAt = performance.now();
      await expect(row.locator('[data-participant-presence="offline"]')).toBeVisible({ timeout: 50_000 });
      console.log(`[presence] TTL offline without beacon: ${Math.round(performance.now() - lostAt)} ms`);
      const resumed = participant.waitForResponse(response => new URL(response.url()).pathname === `/api/s/${fixture.publicToken}/presence` && response.ok() && response.request().postDataJSON()?.action === "heartbeat");
      await participantContext.setOffline(false);
      await resumed;
      await expect(row.locator('[data-participant-presence="online"]')).toBeVisible({ timeout: 5000 });
      await expect.poll(async () => (await fixture.readParticipantPresence(name)).liveConnections).toBe(1);

      // Simulate a browser accepting then losing its best-effort beacon. The
      // real tab is closed; the server must still retain its lease until TTL.
      await participant.evaluate(() => { navigator.sendBeacon = () => true; });
      const closedAt = performance.now();
      await participant.close();
      expect((await fixture.readParticipantPresence(name)).liveConnections).toBe(1);
      await expect(row.locator('[data-participant-presence="offline"]')).toBeVisible({ timeout: 50_000 });
      const closeTtlMs = Math.round(performance.now() - closedAt);
      expect(closeTtlMs).toBeGreaterThan(30_000);
      console.log(`[presence] Closed tab without beacon offline: ${closeTtlMs} ms`);
      expect((await fixture.readParticipantPresence(name)).memberId).toBe(initial.memberId);
      await dashboard.setViewportSize({ width: 390, height: 844 });
      expect(await dashboard.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await Promise.allSettled([participantContext.close(), dashboardContext.close()]); }
  });

  test("manages event participants and operator requests with real Realtime", async ({ browser }) => {
    const dashboardContext = await browser.newContext();
    const participantContext = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.86" } });
    const dashboard = await dashboardContext.newPage();
    const participant = await participantContext.newPage();
    const queuePage = await dashboardContext.newPage();
    const browserErrors: string[] = [];
    const expectedConflicts = new Set<string>();
    observeBrowserErrors(dashboard, browserErrors, expectedConflicts);
    observeBrowserErrors(participant, browserErrors);
    observeBrowserErrors(queuePage, browserErrors);
    try {
      await signInLocalOperator(dashboard, fixture);
      const eventPath = `/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}`;
      await dashboard.goto(`${eventPath}/participants`);
      await expect(dashboard.getByRole("heading", { name: "Uczestnicy wydarzenia" })).toBeVisible();
      await expect(dashboard.locator('[data-participants-realtime="live"]')).toBeVisible();
      await participant.goto(`/join/${fixture.sessionCode}`);
      await participant.getByLabel("Imię lub ksywka").fill("Slice Two Mobile");
      const joinStartedAt = performance.now();
      await participant.getByRole("button", { name: "Dołącz" }).click();
      const mobileRow = dashboard.getByRole("button", { name: "Wybierz uczestnika: Slice Two Mobile" });
      await expect(mobileRow).toBeVisible({ timeout: 5000 });
      console.log(`[participant-management] Join invalidation: ${Math.round(performance.now() - joinStartedAt)} ms`);
      await expect(mobileRow).toContainText("Aktywne: 0/2");
      await mobileRow.click();

      const addCatalogSong = async (title: string) => {
        await dashboard.getByLabel("Tytuł lub wykonawca", { exact: true }).fill(title);
        await dashboard.getByRole("button", { name: "Szukaj w katalogu" }).click();
        await dashboard.getByRole("radio", { name: `${title} · ${title === "E2E Discovery Hit" ? "E2E Discovery Artist" : "E2E Artist"}`, exact: true }).check();
        await dashboard.getByRole("button", { name: "Dodaj zgłoszenie", exact: true }).click();
      };
      await addCatalogSong("E2E Song");
      await expect(mobileRow).toContainText("Aktywne: 1/2");
      const [first] = await fixture.readParticipantRequests("Slice Two Mobile");
      expect(first?.requestedBy).toBe("operator");
      await submitParticipantSong(participant, "E2E Second Song");
      await expect(mobileRow).toContainText("Aktywne: 2/2");
      const requestApi = `/api/dashboard/organizations/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/participants/${first!.eventParticipantId}/requests`;
      expectedConflicts.add(requestApi);
      await addCatalogSong("E2E Discovery Hit");
      await expect(dashboard.getByRole("alert").filter({ hasText: "Ta osoba ma już 2 aktywne zgłoszenia" })).toBeVisible();

      await queuePage.goto(`${eventPath}/queue`);
      const activeQueuePanel = queuePage.locator("[data-event-queue-panel]:visible");
      await expect(activeQueuePanel).toHaveCount(1);
      await expect(activeQueuePanel.locator('[data-realtime-status="live"]')).toBeVisible();
      const queueRow = activeQueuePanel.locator("[data-queue-request-id]").filter({ hasText: "Slice Two Mobile" }).filter({ hasText: "E2E Song" });
      await expect(queueRow).toHaveCount(1);
      await expect(queueRow).toBeVisible();
      await queueRow.getByRole("button", { name: /^Zaakceptuj/ }).click();
      await queueRow.getByRole("button", { name: /^Rozpocznij/ }).click();
      await queueRow.getByRole("button", { name: /^Oznacz jako zagrane/ }).click();
      await expect(mobileRow).toContainText("Aktywne: 1/2");
      await expect(mobileRow).toContainText("Zakończone występy: 1");
      await expect(dashboard.getByRole("alert").filter({ hasText: "Ta osoba ma już 2 aktywne zgłoszenia" })).toBeVisible();

      await dashboard.getByRole("button", { name: "Dodaj uczestnika", exact: true }).click();
      const manualDialog = dashboard.getByRole("dialog", { name: "Dodaj uczestnika", exact: true });
      await manualDialog.getByLabel("Nick uczestnika").fill("Slice Two Manual");
      await manualDialog.getByRole("button", { name: "Utwórz uczestnika" }).click();
      const manualRow = dashboard.getByRole("button", { name: "Wybierz uczestnika: Slice Two Manual" });
      await expect(manualRow).toBeVisible();
      await addCatalogSong("E2E Discovery Hit");
      await expect(manualRow).toContainText("Aktywne: 1/2");
      expect((await fixture.readParticipantRequests("Slice Two Manual"))[0]?.requestedBy).toBe("operator");
      await dashboard.reload();
      await expect(manualRow).toContainText("Aktywne: 1/2");
      await dashboard.setViewportSize({ width: 390, height: 844 });
      await manualRow.click();
      await expect(dashboard.getByRole("heading", { name: "Zgłoszenia i historia" })).toBeVisible();
      expect(await dashboard.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(browserErrors).toEqual([]);
    } finally {
      await Promise.allSettled([participantContext.close(), dashboardContext.close()]);
    }
  });

  test("enforces participant 2/2 through HTTP, reload and real Realtime", async ({ browser }) => {
    const dashboardContext = await browser.newContext();
    const participantContext = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": "203.0.113.85" },
    });
    const dashboard = await dashboardContext.newPage();
    const participant = await participantContext.newPage();
    const browserErrors: string[] = [];
    const expectedConflictPaths = new Set([`/api/s/${fixture.publicToken}/requests`]);
    observeBrowserErrors(dashboard, browserErrors, expectedConflictPaths);
    observeBrowserErrors(participant, browserErrors, expectedConflictPaths);
    try {
      await signInLocalOperator(dashboard, fixture);
      await dashboard.goto(`/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`);
      await expect(dashboard.locator('[data-realtime-status="live"]')).toBeVisible();
      await participant.goto(`/s/${fixture.publicToken}`);
      await participant.getByLabel("Imię lub ksywka").fill("E2E Limit Participant");
      await participant.getByRole("button", { name: "Dołącz" }).click();
      const capacity = (count: number) => participant.getByText(`Aktywne zgłoszenia: ${count}/2`, { exact: true }).first();
      await expect(capacity(0)).toBeVisible();
      await submitParticipantSong(participant, "E2E Song");
      await expect(capacity(1)).toBeVisible();
      await submitParticipantSong(participant, "E2E Second Song");
      await expect(capacity(2)).toBeVisible();
      await participant.reload();
      await expect(capacity(2)).toBeVisible();

      const search = await participantContext.request.get(`/api/s/${fixture.publicToken}/songs/search?q=E2E%20Discovery%20Hit`);
      expect(search.status()).toBe(200);
      const songs: { items: { id: number; title: string }[] } = await search.json();
      const third = songs.items.find(({ title }) => title === "E2E Discovery Hit");
      expect(third).toBeDefined();
      const direct = await participantContext.request.post(`/api/s/${fixture.publicToken}/requests`, {
        headers: { origin: new URL(participant.url()).origin }, data: { songId: third!.id },
      });
      expect(direct.status()).toBe(409);
      expect((await direct.json()).error.code).toBe("SESSION_REQUEST_LIMIT_REACHED");

      const searchbox = participant.getByRole("searchbox");
      await searchbox.fill("E2E Discovery Hit");
      await expect(participant.getByRole("heading", { name: "„E2E Discovery Hit”" })).toBeVisible();
      await participant.getByRole("button", { name: /E2E Discovery Hit/ }).click();
      const submissionResponse = participant.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/s/${fixture.publicToken}/requests` && response.request().method() === "POST",
      );
      await participant.getByRole("button", { name: "Dodaj do kolejki" }).click();
      const deniedSubmission = await submissionResponse;
      expect(deniedSubmission.status()).toBe(409);
      expect((await deniedSubmission.json()).error.code).toBe("SESSION_REQUEST_LIMIT_REACHED");
      await expect(participant.getByText("Masz już 2 aktywne zgłoszenia")).toBeVisible();
      await participant.getByRole("button", { name: "Zamknij szczegóły utworu" }).click();

      const first = dashboard.locator("[data-queue-request-id]")
        .filter({ hasText: "E2E Limit Participant" }).filter({ hasText: "E2E Song" });
      await expect(first).toBeVisible();
      await first.getByRole("button", { name: "Odrzuć" }).click();
      const rejectDialog = dashboard.getByRole("alertdialog", { name: "Odrzucić zgłoszenie?" });
      await expect(rejectDialog).toBeVisible();
      await rejectDialog.getByRole("button", { name: "Anuluj" }).click();
      await expect(first).toBeVisible();
      await expect(capacity(2)).toBeVisible();
      await first.getByRole("button", { name: "Odrzuć" }).click();
      const invalidationStartedAt = performance.now();
      await rejectDialog.getByRole("button", { name: /^Odrzuć/ }).click();
      // No participant action or refresh: operator rejection broadcasts invalidation.
      await expect(capacity(1)).toBeVisible({ timeout: 5_000 });
      console.log(`[participant-limit] Realtime capacity update: ${Math.round(performance.now() - invalidationStartedAt)} ms`);
      await submitParticipantSong(participant, "E2E Discovery Hit");
      await expect(capacity(2)).toBeVisible();
      const rejected = queueLane(dashboard, "rejected").locator("[data-queue-request-id]")
        .filter({ hasText: "E2E Limit Participant" }).filter({ hasText: "E2E Song" });
      const firstRequest = (await fixture.readParticipantRequests("E2E Limit Participant"))
        .find(({ songTitle }) => songTitle === "E2E Song");
      expect(firstRequest).toBeDefined();
      const restorePath = `/api/dashboard/organizations/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue/requests/${firstRequest!.requestId}/action`;
      expectedConflictPaths.add(restorePath);
      const restoreResponse = dashboard.waitForResponse((response) => new URL(response.url()).pathname === restorePath);
      await rejected.getByRole("button", { name: "Przywróć" }).click();
      const deniedRestore = await restoreResponse;
      expect(deniedRestore.status()).toBe(409);
      expect((await deniedRestore.json()).error.code).toBe("SESSION_REQUEST_LIMIT_REACHED");
      await expect(dashboard.getByRole("alert").filter({ hasText: "Ta osoba ma już 2 aktywne zgłoszenia" })).toBeVisible();
      await expect(rejected).toBeVisible();
      expect(browserErrors).toEqual([]);
    } finally {
      await Promise.allSettled([participantContext.close(), dashboardContext.close()]);
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
    // Hard navigations create two leases in React Strict Mode. Exercise the
    // catalog below the real 32-new-connections/minute credential limit.
    // All HTTP requests and rate limits remain real; no response is suppressed.
    let lastDocumentNavigation = 0;
    await context.route("**/*", async route => {
      if (route.request().isNavigationRequest() && route.request().frame() === page.mainFrame()) {
        const delay = Math.max(0, lastDocumentNavigation + 4_500 - Date.now());
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        lastDocumentNavigation = Date.now();
      }
      await route.continue();
    });
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
      await page.getByRole("link", { name: `Rock, ${LOCAL_E2E_ROCK_SONG_COUNT} piosenki`, exact: true }).click();
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
    const closedPresenceResponses: import("@playwright/test").Response[] = [];

    observeBrowserErrors(page, browserErrors);
    observeBrowserErrors(anonymousPage, browserErrors);
    anonymousPage.on("response", response => {
      if (response.status() === 403 && new URL(response.url()).pathname === `/api/s/${fixture.publicToken}/presence`) {
        closedPresenceResponses.push(response);
      }
    });

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
          .getByRole("main")
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
      await expect(anonymousPage.getByRole("heading", { name: "Karaoke dobiegło końca" })).toBeVisible();
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
      // A lease/beacon can race manual close. Validate that precise negative
      // response; every unrelated HTTP, console or runtime error still fails.
      for (const response of closedPresenceResponses) {
        expect(await response.json()).toMatchObject({ error: { code: "SESSION_EVENT_CLOSED" } });
      }
      expect([...browserErrors].sort()).toEqual(closedPresenceResponses.flatMap(() => [
        "HTTP 403 /api/s/[redacted]/presence",
        "Failed to load resource: the server responded with a status of 403 (Forbidden)",
      ]).sort());
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
  expectedConflictPaths: ReadonlySet<string> = new Set(),
) {
  page.on("response", (response) => {
    if (response.status() >= 400 && !(response.status() === 409 && expectedConflictPaths.has(new URL(response.url()).pathname))) {
      errors.push(
        `HTTP ${response.status()} ${sanitizeBrowserUrl(response.url())}`,
      );
    }
  });
  page.on("console", (message) => {
    const expectedResourceConflict = expectedConflictPaths.size > 0 &&
      message.text() === "Failed to load resource: the server responded with a status of 409 (Conflict)";
    if (message.type() === "error" && !expectedResourceConflict) {
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
  const successToast = page.locator("[data-sonner-toast]").filter({ hasText: "Dodano zgłoszenie" });
  await expect(successToast).toBeVisible();
  await successToast.getByRole("button", { name: "Zamknij powiadomienie", exact: true }).click();
  await expect(successToast).toBeHidden();
  await openMyRequests(page);
  await expect(
    participantRequestsSection(page)
      .locator("[data-participant-request-id]")
      .filter({ hasText: title })
      .filter({ hasText: "Oczekujące" }),
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
  requestTitle,
  targetLane,
  targetRequestName,
  cancel = false,
  verifyGeometry = false,
  verifyAutoScroll = false,
}: {
  page: import("@playwright/test").Page;
  sourceLane: "pending" | "approved" | "rejected";
  requestName: string;
  requestTitle?: string;
  targetLane: "pending" | "approved" | "rejected";
  targetRequestName?: string;
  cancel?: boolean;
  verifyGeometry?: boolean;
  verifyAutoScroll?: boolean;
}) {
  const namedSource = queueRequest(page, sourceLane, requestName);
  const source = requestTitle ? namedSource.filter({ hasText: requestTitle }) : namedSource;
  const handle = source.getByRole("button", {
    name: new RegExp(`^Przeciągnij zgłoszenie: ${escapeRegExp(requestName)}`),
  });
  const target = targetRequestName
    ? queueRequest(page, targetLane, targetRequestName)
    : queueLane(page, targetLane).locator("[data-queue-drop-body]");

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
    await page.mouse.up();
    await expect(overlay).toHaveCount(0);
    return;
  }

  const viewport = page.viewportSize();
  if (viewport) {
    const scrollDeadline = Date.now() + 8_000;
    const safeTop = viewport.height * 0.35, safeBottom = viewport.height * 0.65;
    while (Date.now() < scrollDeadline) {
      targetBox = await target.boundingBox();
      const targetDropY = targetBox
        ? targetBox.y + (targetRequestName ? targetBox.height / 4 : Math.min(targetBox.height / 2, 120))
        : null;
      if (
        targetBox &&
        targetDropY !== null &&
        targetDropY >= safeTop &&
        targetDropY <= safeBottom
      ) {
        break;
      }

      await page.mouse.move(
        grabPoint.x,
        targetDropY !== null && targetDropY < safeTop ? 8 : viewport.height - 8,
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
    // Named-card helpers deliberately mean BEFORE, independent of card height.
    y: targetBox.y + (targetRequestName ? targetBox.height / 4 : Math.min(targetBox.height / 2, 120)),
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

  await expect(page.locator("[data-queue-insertion-indicator]")).toHaveAttribute("data-target-lane", targetLane);
  await expect(page.locator("[data-queue-insertion-indicator]")).toHaveAttribute("data-drop-allowed", "true");
  await page.mouse.up();
  if (targetLane === "rejected") {
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: "Odrzuć zgłoszenie", exact: true }).click();
  }
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


test.describe("Enterprise DnD contract", () => {
  let fixture: LocalSupabaseFixture;
  test.setTimeout(240_000);
  test.beforeAll(async () => { fixture = await createLocalSupabaseFixture(); });
  test.afterAll(async () => { await fixture?.cleanup(); });

  test("Enterprise desktop slots match persistence, confirmation, scroll, keyboard, rollback and concurrent operators", async ({ browser }) => {
    await fixture.seedDragQueue();
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await context.newPage(), other = await context.newPage();
    page.setDefaultTimeout(15_000); other.setDefaultTimeout(15_000);
    const path = `/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`;
    const api = `/api/dashboard/organizations/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`;
    await signInLocalOperator(page, fixture); await page.goto(path); await other.goto(path);
    const row = (name: string) => page.locator('[data-queue-request-id]').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
    const names = () => queueRequestNamesInLane(queueLane(page, "approved"));
    const canonical = async () => (await fixture.readQueueRows()).filter(row => row.status === "approved").sort((a,b) => a.position-b.position).map(row => row.displayName);
    let placements = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/placement')) placements++; });
    const begin = async (name: string) => {
      await page.bringToFront();
      await page.waitForLoadState('networkidle');
      const handle = row(name).getByRole('button', { name: /^Przeciągnij/ }); await handle.scrollIntoViewIfNeeded();
      await expect(handle).toBeEnabled(); const box = (await handle.boundingBox())!;
      expect(await handle.evaluate(element => {
        const rect=element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
      })).toBe(true);
      await page.mouse.move(box.x+box.width/2, box.y+box.height/2); await page.mouse.down();
      await page.mouse.move(box.x+box.width/2+12, box.y+box.height/2+8, { steps: 4 });
      await expect(page.locator('[data-queue-drag-overlay]')).toBeVisible();
    };
    const pointAt = async (target: import('@playwright/test').Locator, fraction = 0.25) => {
      // Scroll while the real sensor remains active. Every final target uses new viewport geometry.
      await target.evaluate(element => element.scrollIntoView({ block: 'center' }));
      const box = (await target.boundingBox())!;
      await page.mouse.move(box.x+box.width/2,box.y+Math.min(box.height-1,Math.max(1,box.height*fraction)),{steps:12});
      await expect(page.locator('[data-queue-insertion-indicator]')).toBeVisible();
    };
    const drop = async (name: string, targetName: string, fraction: number, expectedPosition: number) => {
      await begin(name); await pointAt(row(targetName), fraction);
      const indicator=page.locator('[data-queue-insertion-indicator]');
      await expect(indicator).toHaveAttribute('data-target-position',String(expectedPosition));
      const order=await names(); const expected=order.filter(value=>value!==name); expected.splice(expectedPosition-1,0,name);
      const written=page.waitForResponse(response=>response.url().endsWith('/placement')&&response.request().method()==='POST');
      await page.mouse.up(); expect((await written).status()).toBe(200);
      await expect.poll(names).toEqual(expected); await expect.poll(canonical).toEqual(expected);
      await expect(page.getByText('Zmiana kolejki zapisana.',{exact:true})).toBeVisible();
    };
    try {
      // Tall Drag 2 and short Drag 6 must use their own midpoint, in both directions.
      expect((await row('Drag 2').boundingBox())!.height).toBeGreaterThan((await row('Drag 1').boundingBox())!.height+100);
      await drop('Drag 1','Drag 6',0.95,6);
      await drop('Drag 1','Drag 2',0.05,1);
      await drop('Drag 3','Drag 2',0.05,2);
      await drop('Drag 3','Drag 2',0.95,3);
      await drop('Drag 4','Drag 6',0.05,5);
      await begin('Drag 4');
      await row('Drag 2').evaluate(element=>element.scrollIntoView({block:'center'}));
      const upper=(await row('Drag 1').boundingBox())!, lower=(await row('Drag 2').boundingBox())!;
      await page.mouse.move(lower.x+lower.width/2,(upper.y+upper.height+lower.y)/2,{steps:10});
      await expect(page.locator('[data-queue-insertion-indicator]')).toHaveAttribute('data-target-position','2');
      await page.mouse.up(); await expect.poll(async()=> (await canonical())[1]).toBe('Drag 4');
      await drop('Drag 4','Drag 6',0.05,5);
      await begin('Drag Pending'); await pointAt(row('Drag 2'),0.95);
      await expect(page.locator('[data-queue-insertion-indicator]')).toHaveAttribute('data-target-position','3');
      await page.mouse.up(); await expect.poll(canonical).toEqual(['Drag 1','Drag 2','Drag Pending','Drag 3','Drag 5','Drag 4','Drag 6']);
      await expect.poll(names).toEqual(await canonical());
      // Header and outside never resolve to the nearest lane. No write.
      let previous=placements;
      await begin('Drag 1'); const header=queueLane(page,'approved').locator('header'); await header.evaluate(element=>element.scrollIntoView({block:'center'}));
      const hb=(await header.boundingBox())!; await page.mouse.move(hb.x+hb.width/2,hb.y+5,{steps:8});
      await expect(page.locator('[data-queue-insertion-indicator]')).toHaveCount(0); await page.mouse.up(); expect(placements).toBe(previous);
      await begin('Drag 1'); await page.mouse.move(1,1,{steps:10}); await expect(page.locator('[data-queue-insertion-indicator]')).toHaveCount(0); await page.mouse.up(); expect(placements).toBe(previous);
      // Empty rejected lane; cancel first, then explicit confirmation.
      await begin('Drag 1'); await pointAt(queueLane(page,'rejected').locator('[data-queue-drop-body]'),0.5); await page.mouse.up();
      await expect(page.getByRole('alertdialog')).toBeVisible(); expect(placements).toBe(previous);
      await page.getByRole('button',{name:'Anuluj',exact:true}).click(); expect(placements).toBe(previous);
      await begin('Drag 1'); await pointAt(queueLane(page,'rejected').locator('[data-queue-drop-body]'),0.5); await page.mouse.up();
      await page.getByRole('button',{name:'Odrzuć zgłoszenie',exact:true}).click(); await expectQueueStatus(fixture,'Drag 1','rejected');
      await expect(row('Drag 1').getByRole('button',{name:/^Przeciągnij/})).toBeVisible();
      await begin('Drag 1'); await pointAt(queueLane(page,'pending').locator('[data-queue-drop-body]'),0.5); await page.mouse.up(); await expectQueueStatus(fixture,'Drag 1','pending');
      previous=placements; await begin('Drag 1'); await pointAt(queueLane(page,'pending').locator('[data-queue-drop-body]'),0.5);
      await expect(page.locator('[data-queue-insertion-indicator]')).toHaveAttribute('data-drop-allowed','false');
      await page.mouse.up(); expect(placements).toBe(previous);
      // Wait for the lifted state before sending another key (the native sensor
      // attaches its document key listener after the activating Space event).
      const handle=row('Drag 2').getByRole('button',{name:/^Przeciągnij/});
      const liftKeyboard=async()=>{
        await expect(page.locator('[data-queue-drag-overlay]')).toHaveCount(0);
        await handle.scrollIntoViewIfNeeded(); await handle.focus(); await handle.press('Space');
        await expect(page.locator('[data-queue-drag-overlay]')).toBeVisible();
        await page.evaluate(()=>new Promise(requestAnimationFrame));
      };
      await liftKeyboard(); await page.keyboard.press('Escape'); await expect(page.locator('[data-queue-drag-overlay]')).toHaveCount(0);
      await expect(row('Drag 2')).toBeFocused(); await liftKeyboard(); await page.keyboard.press('End');
      await expect(page.locator('[data-queue-insertion-indicator]')).toHaveAttribute('data-target-position','6'); await page.keyboard.press('Space');
      await expect.poll(async()=> (await canonical()).at(-1)).toBe('Drag 2');
      await liftKeyboard(); await page.keyboard.press('Home');
      await expect(page.locator('[data-queue-insertion-indicator]')).toHaveAttribute('data-target-position','1'); await page.keyboard.press('Space');
      await expect.poll(async()=> (await canonical())[0]).toBe('Drag 2');
      await liftKeyboard(); await page.keyboard.press('End');
      await expect(page.locator('[data-queue-insertion-indicator]')).toHaveAttribute('data-target-position','6'); await page.keyboard.press('Space');
      await expect.poll(async()=> (await canonical()).at(-1)).toBe('Drag 2');
      // Backend 500 -> optimistic rollback and canonical recovery, no stale success.
      await page.route('**/placement',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'Retry.'}})}),{times:1});
      const beforeFailure=await canonical(); await begin('Drag 3'); await pointAt(row('Drag 2'),0.95); await page.mouse.up();
      await expect(page.getByText('Nie udało się zapisać zmiany',{exact:true})).toBeVisible(); await expect.poll(names).toEqual(beforeFailure); expect(await canonical()).toEqual(beforeFailure);
      // Two tabs/operators: real Realtime invalidates a gesture and does not write it.
      await expect(page.locator('[data-realtime-status]')).toHaveAttribute('data-realtime-status','live');
      await other.reload(); const third=other.locator('[data-queue-request-id]').filter({hasText:'Drag 3'});
      previous=placements; await begin('Drag 3');
      await third.getByRole('button',{name:/^Przesuń zgłoszenie w dół/}).click();
      await expect(page.locator('[data-queue-drag-overlay]')).toHaveCount(0); await page.mouse.up(); expect(placements).toBe(previous);
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect.poll(names).toEqual(await canonical());
      await other.reload(); await begin('Drag 4');
      await other.getByRole('button',{name:'Ułóż sprawiedliwie',exact:true}).click();
      await other.getByRole('button',{name:'Zastosuj kolejność',exact:true}).click();
      await expect(page.locator('[data-queue-drag-overlay]')).toHaveCount(0); await page.mouse.up();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect.poll(names).toEqual(await canonical());
      // A concurrent write after pointer-up but before the server obtains the mutex.
      // The actual gesture still sends its frozen version and must get a 409.
      await page.waitForLoadState('networkidle'); await other.reload();
      const beforeConflict=await names(); const sourceName=beforeConflict[0], targetName=beforeConflict.at(-1)!;
      const competitor=(await fixture.readQueueRows()).find(row=>row.displayName===beforeConflict[1])!;
      await page.route('**/placement',async route=>{
        expect((await other.request.post(`${api}/requests/${competitor.requestId}/move`,{data:{direction:'up'}})).status()).toBe(200);
        await route.continue();
      },{times:1});
      await begin(sourceName); await pointAt(row(targetName),0.95);
      const conflict=page.waitForResponse(response=>response.url().endsWith('/placement'));
      await page.mouse.up(); const stale=await conflict;
      expect(stale.status()).toBe(409); expect((await stale.json()).error.code).toBe('QUEUE_PLACEMENT_STALE');
      await expect(page.getByText(/Kolejka została zmieniona przez innego operatora/)).toBeVisible();
      await expect.poll(names).toEqual(await canonical());
      await page.reload(); await expect.poll(names).toEqual(await canonical());
      expect(await row('Drag Now').getByRole('button',{name:/^Przeciągnij/}).count()).toBe(0);
      await page.screenshot({path:'.artifacts/dnd-desktop-final.png',fullPage:true});
    } finally { await context.close(); }
  });

  test("Enterprise emulated touch separates scrolling and long press, autoscrolls and supports tablet orientations", async ({ browser }) => {
    await fixture.seedDragQueue(12);
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page=await context.newPage(); await signInLocalOperator(page,fixture);
    page.setDefaultTimeout(15_000);
    await page.goto(`/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`);
    const session=await context.newCDPSession(page);
    const touch=async(type:'touchStart'|'touchMove'|'touchEnd',x=0,y=0)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1,radiusX:5,radiusY:5}]});
    const approved=queueLane(page,'approved');
    try {
      await approved.locator('[data-queue-request-id]').first().scrollIntoViewIfNeeded();
      const b=(await approved.locator('[data-queue-request-id]').first().boundingBox())!;
      const scrollBefore=await page.evaluate(()=>window.scrollY);
      await touch('touchStart',b.x+40,b.y+80); for(let i=1;i<=8;i++){await touch('touchMove',b.x+40,b.y+80-i*20);await page.waitForTimeout(25);} await touch('touchEnd');
      expect(await page.evaluate(()=>window.scrollY)).toBeGreaterThan(scrollBefore); await expect(page.locator('[data-queue-drag-overlay]')).toHaveCount(0);
      const source=approved.locator('[data-queue-request-id]').filter({has:page.locator('strong',{hasText:/^Drag 1$/})});
      const handle=source.getByRole('button',{name:/^Przeciągnij/}); await handle.scrollIntoViewIfNeeded(); const h=(await handle.boundingBox())!;
      const x=h.x+h.width/2,y=h.y+h.height/2;
      await touch('touchStart',x,y); await page.waitForTimeout(300); await touch('touchMove',x,y+14);
      await expect(page.locator('[data-queue-drag-overlay]')).toBeVisible();
      const before=await page.evaluate(()=>window.scrollY);
      await touch('touchMove',x,830); await page.waitForTimeout(650);
      expect(await page.evaluate(()=>window.scrollY)).toBeGreaterThan(before);
      // Move the target into view while the actual touch sensor remains active.
      const target=approved.locator('[data-queue-request-id]').filter({has:page.locator('strong',{hasText:/^Drag 4$/})});
      await target.evaluate(element=>element.scrollIntoView({block:'center'})); const t=(await target.boundingBox())!;
      await touch('touchMove',t.x+t.width/2,t.y+t.height-5);
      await expect(page.locator('[data-queue-insertion-indicator]')).toHaveAttribute('data-target-position','4');
      await touch('touchEnd'); await expect.poll(async()=>(await fixture.readQueueRows()).find(row=>row.displayName==='Drag 1')!.position).toBe(4);
      await page.reload(); await expect(approved.locator('[data-queue-request-id]').nth(3)).toContainText('Drag 1');
      for(const viewport of [{width:768,height:1024},{width:1024,height:768}]){
        await page.setViewportSize(viewport); await expect(page.locator('[data-queue-board]')).toBeVisible();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      }
      await page.emulateMedia({reducedMotion:'reduce'}); await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:'.artifacts/dnd-mobile-final.png',fullPage:true});
    } finally { await context.close(); }
  });
});

async function liftQueueKeyboard(page: import("@playwright/test").Page, handle: import("@playwright/test").Locator) {
  await expect(page.locator("[data-queue-drag-overlay]")).toHaveCount(0);
  await handle.focus(); await handle.press("Space");
  await expect(page.locator("[data-queue-drag-overlay]")).toBeVisible();
  await page.evaluate(() => new Promise(requestAnimationFrame));
}
