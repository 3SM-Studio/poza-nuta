import assert from "node:assert/strict";
import test from "node:test";

import { resolveOptionalOverviewSection } from "../src/server/operator-api/overview-fallback.ts";
import { ServerStepTimeoutError } from "../src/server/runtime-diagnostics.ts";

test("organization overview can return partial fallback for optional section timeout", async () => {
  const originalWarn = console.warn;

  console.warn = () => {};

  try {
    const result = await resolveOptionalOverviewSection({
      routeName: "dashboard.org",
      stepName: "topSongs",
      action: async () => {
        throw new ServerStepTimeoutError("dashboard.org", "topSongs", 10);
      },
      fallback: [],
    });

    assert.deepEqual(result, {
      data: [],
      failed: true,
    });
  } finally {
    console.warn = originalWarn;
  }
});

test("organization overview can return partial fallback for counts timeout", async () => {
  const originalWarn = console.warn;
  const fallbackStats = {
    activeEvents: 0,
    totalEvents: 0,
    requestsToday: 0,
    requestsLastSevenDays: 0,
    pendingRequests: 0,
    acceptedRequests: 0,
    performedRequests: 0,
    members: 0,
    catalogSongs: 0,
  };

  console.warn = () => {};

  try {
    const result = await resolveOptionalOverviewSection({
      routeName: "dashboard.org",
      stepName: "overview.counts",
      action: async () => {
        throw new ServerStepTimeoutError("dashboard.org", "overview.counts", 10);
      },
      fallback: fallbackStats,
    });

    assert.deepEqual(result, {
      data: fallbackStats,
      failed: true,
    });
  } finally {
    console.warn = originalWarn;
  }
});

test("organization overview optional section rethrows non-infrastructure errors", async () => {
  const originalWarn = console.warn;

  console.warn = () => {};

  try {
    await assert.rejects(
      resolveOptionalOverviewSection({
        routeName: "dashboard.org",
        stepName: "recentEvents",
        action: async () => {
          throw new Error("invalid query shape");
        },
        fallback: [],
      }),
      /invalid query shape/,
    );
  } finally {
    console.warn = originalWarn;
  }
});
