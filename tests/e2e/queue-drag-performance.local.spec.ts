import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, totalmem, platform, release } from "node:os";
import { createLocalSupabaseFixture } from "./local-supabase-fixture";

type Probe = {
  running: boolean; frames: number[]; longTasks: number[]; inputDispatchMs: number[];
  indicatorToFrameMs: number[]; previousFrame: number; lastInput: number;
  boardFirstFrameMs: number | null;
  phase: "activation" | "tracking" | "scroll" | "final";
};
declare global { interface Window { __queueAudit: Probe } }

const metrics = async (page: Page) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  return session;
};
const values = (result: { metrics: { name: string; value: number }[] }) =>
  Object.fromEntries(result.metrics.map(row => [row.name, row.value]));

test("production DnD audit: 20, 50 and 100 total requests, three real gestures each", async ({ browser, baseURL }) => {
  // Refuse standalone execution against inherited development/Preview credentials.
  expect(process.env.LOCAL_E2E_PERFORMANCE).toBe("1");
  expect(baseURL).toBe("http://localhost:3105");
  const database = new URL(process.env.LOCAL_E2E_DATABASE_URL!);
  expect(["127.0.0.1", "localhost"]).toContain(database.hostname);
  expect(database.port).toBe("55432");
  expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:55431");
  const fixture = await createLocalSupabaseFixture();
  const samples: Record<string, unknown>[] = [];
  const browserSession = await browser.newBrowserCDPSession();
  const info = await browserSession.send("SystemInfo.getInfo");
  const environment = {
    timestamp: new Date().toISOString(), browser: browser.version(), platform: platform(), release: release(),
    cpu: cpus()[0].model, logicalCpus: cpus().length, memoryBytes: totalmem(),
    gpu: info.gpu.devices.map(device => ({ vendor: device.vendorString, device: device.deviceString })),
    renderer: info.gpu.auxAttributes?.glRenderer, headless: true, viewport: { width: 1500, height: 1000 },
    cpuThrottling: 1, network: "loopback, no network throttling", runtime: "Next optimized build + next start",
    cadence: "60 alternating target moves, 16 ms requested pause after each; 700 ms edge autoscroll",
  };
  try {
    for (const total of [20, 50, 100]) {
      // Total includes one Pending and one Now; approved cards = total - 2.
      await fixture.seedDragQueue(total - 2);
      const context = await browser.newContext({ viewport: environment.viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      await page.addInitScript(({ total }) => {
        const probe: Probe = window.__queueAudit = { running: false, frames: [], longTasks: [], inputDispatchMs: [],
          indicatorToFrameMs: [], previousFrame: 0, lastInput: 0, boardFirstFrameMs: null, phase: "activation" };
        const frame = (now: number) => {
          if (probe.running && probe.previousFrame) probe.frames.push(now - probe.previousFrame);
          probe.previousFrame = probe.running ? now : 0;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        new PerformanceObserver(list => {
          if (probe.running) for (const entry of list.getEntries()) probe.longTasks.push(entry.duration);
        }).observe({ type: "longtask", buffered: false });
        document.addEventListener("mousemove", event => {
          if (!probe.running) return;
          probe.lastInput = performance.now();
          probe.inputDispatchMs.push(Math.max(0, performance.now() - event.timeStamp));
        }, { capture: true, passive: true });
        let previousTarget = "", measuredInput = 0;
        new MutationObserver(() => {
          if (probe.boardFirstFrameMs === null && document.querySelectorAll('[data-queue-request-id]').length >= total) {
            probe.boardFirstFrameMs = -1;
            requestAnimationFrame(() => requestAnimationFrame(() => { probe.boardFirstFrameMs = performance.now(); }));
          }
          const indicator = document.querySelector('[data-queue-insertion-indicator]');
          const target = indicator ? `${indicator.getAttribute('data-target-lane')}:${indicator.getAttribute('data-target-position')}` : "";
          // Native autoscroll changes slots without a new input event. It is
          // not input latency; only pair explicit tracking inputs once each.
          if (probe.running && probe.phase === "tracking" && target && previousTarget !== target && probe.lastInput > measuredInput) {
            const inputAt = probe.lastInput;
            measuredInput = inputAt;
            requestAnimationFrame(() => { if (probe.running) probe.indicatorToFrameMs.push(performance.now() - inputAt); });
          }
          previousTarget = target;
        }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-target-position", "data-target-lane"] });
      }, { total });
      try {
        await page.goto("/sign-in");
        await page.getByLabel("E-mail").fill(fixture.email);
        await page.getByLabel("Hasło").fill(fixture.password);
        await page.getByRole("button", { name: "Zaloguj się" }).click();
        await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
        // Sign-in performs router.replace + router.refresh. Wait for that
        // navigation to settle before starting measured full navigations.
        await page.waitForLoadState("networkidle");
        const cdp = await metrics(page);
        const path = `/dashboard/org/${fixture.organizationPublicId}/events/${fixture.eventPublicId}/queue`;
        for (let repetition = 1; repetition <= 3; repetition++) {
          const beforeNavigation = values(await cdp.send("Performance.getMetrics"));
          await page.goto(path, { waitUntil: "domcontentloaded" });
          const approved = page.locator('[data-queue-lane="approved"]:visible');
          await expect(approved.locator('[data-queue-request-id]')).toHaveCount(total - 2);
          await expect(page.locator('[data-event-queue-panel]:visible [data-realtime-status]')).toHaveAttribute('data-realtime-status', 'live');
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const ready = await page.evaluate(() => ({ boardFirstFrameMs: window.__queueAudit.boardFirstFrameMs, interactiveMs: performance.now(),
            responseEndMs: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).responseEnd }));
          const afterNavigation = values(await cdp.send("Performance.getMetrics"));
          const source = approved.locator('[data-queue-request-id]').first();
          const sourceId = Number(await source.getAttribute('data-queue-request-id'));
          const handle = source.getByRole('button', { name: /^Przeciągnij/ });
          await handle.scrollIntoViewIfNeeded();
          const box = (await handle.boundingBox())!;
          const target = approved.locator('[data-queue-request-id]').nth(1);
          await page.evaluate(() => { const p=window.__queueAudit; p.frames=[];p.longTasks=[];p.indicatorToFrameMs=[];p.inputDispatchMs=[];p.previousFrame=0;p.running=true; });
          const beforeGesture = values(await cdp.send("Performance.getMetrics"));
          await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
          const activationStart=performance.now();
          await page.mouse.move(box.x+box.width/2+12,box.y+box.height/2+8,{steps:3});
          await expect(page.locator('[data-queue-drag-overlay]')).toBeVisible();
          const activationMs=performance.now()-activationStart;
          await target.evaluate(element=>element.scrollIntoView({block:'center'}));
          const rect=(await target.boundingBox())!;
          await page.evaluate(()=>{window.__queueAudit.phase="tracking";window.__queueAudit.lastInput=0;});
          for(let i=0;i<60;i++) {
            await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height*(i%2?0.7:0.3));
            await page.waitForTimeout(16);
          }
          const scrollBefore=await page.evaluate(()=>window.scrollY);
          await page.evaluate(()=>{window.__queueAudit.phase="scroll";});
          const scrollStart=performance.now();
          await page.mouse.move(rect.x+rect.width/2,990); await page.waitForTimeout(700);
          const autoScroll={ pixels: (await page.evaluate(()=>window.scrollY))-scrollBefore, elapsedMs: performance.now()-scrollStart };
          expect(autoScroll.pixels).toBeGreaterThan(0);
          await page.evaluate(()=>{window.__queueAudit.phase="final";});
          // Leave the edge before measuring the final rect: continuing native
          // autoscroll would move the target between boundingBox and mouseMove.
          await page.mouse.move(rect.x+rect.width/2,500);
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const last=approved.locator('[data-queue-request-id]').last();
          await last.evaluate(element=>element.scrollIntoView({block:'center'}));
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const lastRect=(await last.boundingBox())!;
          await page.mouse.move(lastRect.x+lastRect.width/2,lastRect.y+lastRect.height*0.95);
          console.log(`[queue-performance] final target geometry ${JSON.stringify({total,repetition,x:lastRect.x,y:lastRect.y,height:lastRect.height})}`);
          await expect(page.locator('[data-queue-insertion-indicator]')).toHaveAttribute('data-target-position',String(total-2));
          const afterGesture=values(await cdp.send("Performance.getMetrics"));
          const gesture=await page.evaluate(()=>{window.__queueAudit.running=false;return window.__queueAudit;});
          const responsePromise=page.waitForResponse(response=>response.url().endsWith('/placement')&&response.request().method()==='POST');
          const up=performance.now(); await page.mouse.up(); const response=await responsePromise;
          const responseMs=performance.now()-up; expect(response.status()).toBe(200);
          const responseBytes=(await response.body()).byteLength;
          await expect(page.getByText('Zmiana kolejki zapisana.',{exact:true})).toBeVisible();
          const savedMs=performance.now()-up;
          const rows=await fixture.readQueueRows(); const ordered=rows.filter(row=>row.status==='approved').sort((a,b)=>a.position-b.position);
          expect(rows).toHaveLength(total); expect(new Set(rows.map(row=>row.requestId)).size).toBe(total);
          expect(ordered.map(row=>row.position)).toEqual(ordered.map((_,i)=>i+1));
          expect(Number(ordered.at(-1)!.requestId)).toBe(sourceId); expect(rows.filter(row=>row.status==='now')).toHaveLength(1);
          samples.push({ total, approved:total-2, repetition, ...ready, activationMs, autoScroll, responseMs, savedMs, responseBytes,
            renderScriptMs:1000*(afterNavigation.ScriptDuration-beforeNavigation.ScriptDuration),
            renderLayoutMs:1000*(afterNavigation.LayoutDuration-beforeNavigation.LayoutDuration),
            gestureScriptMs:1000*(afterGesture.ScriptDuration-beforeGesture.ScriptDuration),
            gestureLayoutMs:1000*(afterGesture.LayoutDuration-beforeGesture.LayoutDuration),
            heapBytes:afterNavigation.JSHeapUsedSize, frames:gesture.frames,longTasks:gesture.longTasks,
            inputDispatchMs:gesture.inputDispatchMs, indicatorToFrameMs:gesture.indicatorToFrameMs });
          console.log(`[queue-performance] total=${total} repetition=${repetition} persisted=${total-2} samples=${gesture.frames.length}`);
        }
      } finally { await context.close(); }
    }
  } finally {
    await mkdir('.artifacts',{recursive:true});
    await writeFile('.artifacts/dnd-performance-raw.json',JSON.stringify({environment,samples},null,2));
    await fixture.cleanup(); await browserSession.detach();
  }
});
