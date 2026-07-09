import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getDashboardEntryStatus } from "../src/components/public/api.ts";
import { publicApiErrorResponse } from "../src/server/public-api/responses.ts";

test("dashboard entry is visible only for an active dashboard session", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalVercelUrl = process.env.VERCEL_URL;
  const originalSiteUrl = process.env.SITE_URL;

  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv("VERCEL_URL", originalVercelUrl);
    restoreEnv("SITE_URL", originalSiteUrl);
  });

  process.env.VERCEL_URL = "poza-nuta-mrcdscusz-victor-sukhodolsky.vercel.app";
  process.env.SITE_URL =
    "https://poza-nuta-mrcdscusz-victor-sukhodolsky.vercel.app";

  globalThis.fetch = async (input, init) => {
    assert.equal(input, "/api/dashboard/me");
    assert.equal(init?.credentials, "same-origin");

    return Response.json({
      operator: {
        id: 1,
        name: "Operator",
        active: true,
      },
    });
  };

  assert.deepEqual(await getDashboardEntryStatus(), {
    canEnterDashboard: true,
  });

  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "A valid Supabase Auth session is required.",
        },
      },
      { status: 401 },
    );

  assert.deepEqual(await getDashboardEntryStatus(), {
    canEnterDashboard: false,
  });
});

test("public API maps database timeout to controlled 503", () => {
  const source = readFileSync(
    new URL("../src/server/public-api/responses.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /isTransientInfrastructureError/);
  assert.match(source, /SERVICE_UNAVAILABLE/);
  assert.match(source, /503/);
});

test("public active event API uses a read-only lookup path", () => {
  const publicServiceSource = readFileSync(
    new URL("../src/server/public-api/service.ts", import.meta.url),
    "utf8",
  );
  const lifecycleSource = readFileSync(
    new URL("../src/server/event-lifecycle.ts", import.meta.url),
    "utf8",
  );
  const activeEventStart = publicServiceSource.indexOf(
    "export async function getActivePublicEvent",
  );
  const activeEventEnd = publicServiceSource.indexOf(
    "export async function searchPublicSongs",
  );
  const activeEventSource = publicServiceSource.slice(
    activeEventStart,
    activeEventEnd,
  );
  const readOnlyStart = lifecycleSource.indexOf(
    "export async function getActivePublicEventReadOnly",
  );
  const readOnlyEnd = lifecycleSource.indexOf(
    "export async function closeExpiredActiveEventInTransaction",
  );
  const readOnlySource = lifecycleSource.slice(readOnlyStart, readOnlyEnd);

  assert.match(activeEventSource, /getActivePublicEventReadOnly/);
  assert.equal(activeEventSource.includes("getActiveEventAfterLazyClose"), false);
  assert.equal(
    activeEventSource.includes("closeExpiredActiveEventInTransaction"),
    false,
  );
  assert.equal(readOnlySource.includes(".transaction("), false);
  assert.equal(readOnlySource.includes(".update("), false);
  assert.match(readOnlySource, /lte\(events\.startsAt, now\)/);
  assert.match(readOnlySource, /gt\(events\.autoCloseAt, now\)/);
});

test("public queue respects queue visibility before loading items", () => {
  const publicServiceSource = readFileSync(
    new URL("../src/server/public-api/service.ts", import.meta.url),
    "utf8",
  );
  const queueStart = publicServiceSource.indexOf(
    "export async function getPublicQueue",
  );
  const queueEnd = publicServiceSource.indexOf("function escapeLikePattern");
  const queueSource = publicServiceSource.slice(queueStart, queueEnd);
  const disabledBranchStart = queueSource.indexOf("if (!event.publicQueueEnabled)");
  const firstQueueItemsStart = queueSource.indexOf("queueItems");

  assert.ok(disabledBranchStart >= 0);
  assert.ok(firstQueueItemsStart > disabledBranchStart);
  assert.match(queueSource, /enabled: false as const/);
  assert.match(queueSource, /showSongTitles: event\.publicShowSongTitles/);
});

test("public API response returns JSON 503 for Postgres statement timeout", async () => {
  const originalError = console.error;

  console.error = () => {};

  try {
    const response = publicApiErrorResponse(
      new Error("canceling statement due to statement timeout"),
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "The service is temporarily unavailable.",
      },
    });
  } finally {
    console.error = originalError;
  }
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
