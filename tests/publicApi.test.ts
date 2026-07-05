import assert from "node:assert/strict";
import test from "node:test";

import { getDashboardEntryStatus } from "../src/components/public/api.ts";

test("dashboard entry is visible only for an active dashboard session", async (t) => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

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
