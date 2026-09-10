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

test("legacy public active event and queue APIs return controlled 410", () => {
  const publicEventRouteSource = readFileSync(
    new URL("../src/app/api/public/event/route.ts", import.meta.url),
    "utf8",
  );
  const publicQueueRouteSource = readFileSync(
    new URL("../src/app/api/public/queue/route.ts", import.meta.url),
    "utf8",
  );
  const publicServiceSource = readFileSync(
    new URL("../src/server/public-api/service.ts", import.meta.url),
    "utf8",
  );

  assert.match(publicEventRouteSource, /PUBLIC_ACTIVE_EVENT_ENDPOINT_GONE/);
  assert.match(publicQueueRouteSource, /PUBLIC_QUEUE_ENDPOINT_GONE/);
  assert.match(publicEventRouteSource, /legacyGoneResponse/);
  assert.match(publicQueueRouteSource, /legacyGoneResponse/);
  assert.doesNotMatch(publicServiceSource, /export async function getActivePublicEvent/);
  assert.doesNotMatch(publicServiceSource, /export async function getPublicQueue/);
  assert.doesNotMatch(publicServiceSource, /getActivePublicEventReadOnly/);
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

test("public API response returns a safe JSON 503 for Session Pooler exhaustion", async () => {
  const originalError = console.error;
  const logs: string[] = [];

  console.error = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const response = publicApiErrorResponse(
      new Error("Failed query", {
        cause: new Error(
          "EMAXCONNSESSION: max clients in session mode reached secret-host",
        ),
      }),
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "The service is temporarily unavailable.",
      },
    });
    assert.match(logs.join("\n"), /error_code="EMAXCONNSESSION"/);
    assert.doesNotMatch(logs.join("\n"), /secret-host/);
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
