import assert from "node:assert/strict";
import test from "node:test";

import {
  dashboardApiPaths,
  formatDuration,
  getDashboardEventAccessLinkRevokePath,
  getDashboardRequestActionPath,
} from "../src/components/operator/api.ts";
import {
  getDashboardQueueRealtimeTopic,
  isDashboardQueueChangedPayload,
} from "../src/components/operator/dashboard-queue-realtime.ts";

test("formatDuration formats queue durations for the operator UI", () => {
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3_605), "60:05");
});

test("operator UI client uses canonical dashboard API paths", () => {
  assert.deepEqual(dashboardApiPaths, {
    login: "/api/dashboard/login",
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
