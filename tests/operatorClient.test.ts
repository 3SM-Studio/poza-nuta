import assert from "node:assert/strict";
import test from "node:test";

import {
  dashboardApiPaths,
  formatDuration,
  getDashboardRequestActionPath,
} from "../components/operator/api.ts";

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
  });
  assert.equal(
    getDashboardRequestActionPath(42, "approve"),
    "/api/dashboard/requests/42/approve",
  );
});
