import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getDashboardEntryStatus } from "../src/components/public/api.ts";

test("dashboard entry is visible only for an active dashboard session", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalVercelUrl = process.env.VERCEL_URL;
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv("VERCEL_URL", originalVercelUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", originalSiteUrl);
  });

  process.env.VERCEL_URL = "poza-nuta-mrcdscusz-victor-sukhodolsky.vercel.app";
  process.env.NEXT_PUBLIC_SITE_URL =
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

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
