import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  dashboardApiPaths,
  formatDuration,
  getCurrentOperator,
  getDashboardEventAccessLinkRevokePath,
  getDashboardRequestActionPath,
} from "../src/components/operator/api.ts";
import {
  getDashboardQueueRealtimeTopic,
  getPublicQueueRealtimeTopic,
  isDashboardQueueChangedPayload,
  isPublicQueueChangedPayload,
} from "../src/lib/queue-realtime.ts";

test("formatDuration formats queue durations for the operator UI", () => {
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3_605), "60:05");
});

test("operator UI client uses canonical dashboard API paths", () => {
  assert.deepEqual(dashboardApiPaths, {
    login: "/api/dashboard/login",
    signup: "/api/dashboard/signup",
    logout: "/api/dashboard/logout",
    me: "/api/dashboard/me",
    queue: "/api/dashboard/queue",
    event: "/api/dashboard/event",
    extendEvent: "/api/dashboard/event/extend",
    closeEvent: "/api/dashboard/event/close",
    startEvent: "/api/dashboard/event/start",
    accessLinks: "/api/dashboard/event/access-links",
  });
  assert.equal(
    getDashboardRequestActionPath(42, "approve"),
    "/api/dashboard/requests/42/approve",
  );
  assert.equal(
    getDashboardEventAccessLinkRevokePath(42),
    "/api/dashboard/event/access-links/42/revoke",
  );
});

test("operator me request stays on a same-origin relative API path", async (t) => {
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

  assert.deepEqual(await getCurrentOperator(), {
    operator: {
      id: 1,
      name: "Operator",
      active: true,
    },
  });
});

test("client API modules do not build own API URLs from deployment origins", () => {
  const files = [
    new URL("../src/components/operator/api.ts", import.meta.url),
    new URL("../src/components/public/api.ts", import.meta.url),
  ];

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    assert.doesNotMatch(
      source,
      /VERCEL_URL|SITE_URL|NEXT_PUBLIC_APP_URL|NEXT_PUBLIC_BASE_URL|window\.location\.origin/,
    );
    assert.doesNotMatch(
      source,
      /https?:\/\/[^"`']+\/api\/dashboard\/me/,
    );
  }
});

test("dashboard queue realtime helpers scope messages to an event topic", () => {
  assert.equal(
    getDashboardQueueRealtimeTopic(42),
    "dashboard:event:42:queue",
  );
  assert.throws(() => getDashboardQueueRealtimeTopic(0));

  assert.equal(
    isDashboardQueueChangedPayload(
      {
        eventId: 42,
        type: "queue_changed",
        operation: "UPDATE",
        changedAt: "2026-07-03T12:00:00.000Z",
      },
      42,
    ),
    true,
  );
  assert.equal(
    isDashboardQueueChangedPayload(
      {
        eventId: 7,
        type: "queue_changed",
        operation: "UPDATE",
        changedAt: "2026-07-03T12:00:00.000Z",
      },
      42,
    ),
    false,
  );
  assert.equal(
    isDashboardQueueChangedPayload(
      {
        eventId: 42,
        type: "queue_changed",
        operation: "UPSERT",
        changedAt: "2026-07-03T12:00:00.000Z",
      },
      42,
    ),
    false,
  );
});

test("public queue realtime helpers expose invalidation only", () => {
  assert.equal(getPublicQueueRealtimeTopic(42), "public:event:42:queue");
  assert.throws(() => getPublicQueueRealtimeTopic(-1));
  assert.equal(
    isPublicQueueChangedPayload({
      type: "queue_changed",
      changedAt: "2026-07-03T12:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    isPublicQueueChangedPayload({
      type: "queue_changed",
      eventId: 42,
      operation: "UPDATE",
    }),
    false,
  );
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
