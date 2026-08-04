import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EVENT_SESSION_TOKEN_BYTES,
  generateEventSessionIdentity,
  isEventPublicId,
  isEventSessionPublicToken,
  withEventSessionIdentityRetry,
} from "../src/lib/event-session-identity.ts";
import {
  canReopenEvent,
  canResolveEventJoinCode,
  EVENT_REOPEN_GRACE_MINUTES,
  getEventReopenDeadline,
} from "../src/lib/event-session-lifecycle.ts";
import { parseDashboardEventIdentifier } from "../src/lib/dashboard-event-identifier.ts";

test("event session identities use UUID plus exactly 16 CSPRNG bytes as Base64URL", () => {
  const identities = Array.from({ length: 64 }, generateEventSessionIdentity);

  assert.equal(EVENT_SESSION_TOKEN_BYTES, 16);
  assert.equal(new Set(identities.map(({ publicToken }) => publicToken)).size, 64);
  assert.equal(new Set(identities.map(({ eventPublicId }) => eventPublicId)).size, 64);

  for (const identity of identities) {
    assert.equal(isEventPublicId(identity.eventPublicId), true);
    assert.equal(isEventSessionPublicToken(identity.publicToken), true);
    assert.equal(identity.publicToken.length, 22);
    assert.equal(Buffer.from(identity.publicToken, "base64url").length, 16);
  }
});

test("identity generation retries only bounded collisions", async () => {
  let calls = 0;
  const result = await withEventSessionIdentityRetry(
    async (identity) => {
      calls += 1;
      if (calls < 3) throw { code: "23505", constraint: "identity" };
      return identity;
    },
    (error) =>
      typeof error === "object" && error !== null && "code" in error,
    { attempts: 3 },
  );

  assert.equal(calls, 3);
  assert.equal(isEventSessionPublicToken(result.publicToken), true);

  await assert.rejects(
    withEventSessionIdentityRetry(
      async () => {
        throw new Error("not a collision");
      },
      () => false,
      { attempts: 8 },
    ),
    /not a collision/,
  );
});

test("reopen and code resolution use the strict twenty-minute boundary", () => {
  const closedAt = new Date("2026-07-18T12:00:00.000Z");
  const event = {
    status: "closed",
    startsAt: new Date("2026-07-18T10:00:00.000Z"),
    autoCloseAt: null,
    endsAt: new Date("2026-07-18T14:00:00.000Z"),
    closedAt,
    closeReason: "manual",
  };

  assert.equal(EVENT_REOPEN_GRACE_MINUTES, 20);
  assert.equal(
    getEventReopenDeadline(event)?.toISOString(),
    "2026-07-18T12:20:00.000Z",
  );
  assert.equal(canReopenEvent(event, new Date("2026-07-18T12:19:59.000Z")), true);
  assert.equal(canResolveEventJoinCode(event, new Date("2026-07-18T12:19:59.000Z")), true);
  assert.equal(canReopenEvent(event, new Date("2026-07-18T12:20:00.000Z")), false);
  assert.equal(canResolveEventJoinCode(event, new Date("2026-07-18T12:20:00.000Z")), false);
  assert.equal(canReopenEvent(event, new Date("2026-07-18T12:20:01.000Z")), false);
});

test("automatic closure measures grace from the scheduled close instant", () => {
  const event = {
    status: "closed",
    startsAt: new Date("2026-07-18T10:00:00.000Z"),
    autoCloseAt: new Date("2026-07-18T12:00:00.000Z"),
    endsAt: new Date("2026-07-18T12:00:00.000Z"),
    closedAt: new Date("2026-07-18T12:02:00.000Z"),
    closeReason: "automatic",
  };

  assert.equal(canReopenEvent(event, new Date("2026-07-18T12:19:59.000Z")), true);
  assert.equal(canReopenEvent(event, new Date("2026-07-18T12:20:00.000Z")), false);
});

test("dashboard event identifiers accept only public UUIDs", () => {
  assert.deepEqual(
    parseDashboardEventIdentifier("123E4567-E89B-42D3-A456-426614174000"),
    { kind: "public", value: "123e4567-e89b-42d3-a456-426614174000" },
  );
  assert.equal(parseDashboardEventIdentifier("42"), null);
  assert.equal(parseDashboardEventIdentifier("0"), null);
  assert.equal(parseDashboardEventIdentifier("not-an-id"), null);
});

test("session code rotation uses a server-bound stale-state guard", async () => {
  const [serviceSource, settingsSource] = await Promise.all([
    readFile(
      new URL("../src/server/operator-api/organizations.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/app/dashboard/org/[organizationId]/events/[eventId]/settings/page.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(serviceSource, /expectedSessionCode: string/);
  assert.match(
    serviceSource,
    /identity\.sessionCode !== input\.expectedSessionCode/,
  );
  assert.match(serviceSource, /"EVENT_SESSION_CODE_STALE"/);
  assert.match(
    settingsSource,
    /rotateSessionCode\.bind\([\s\S]*?result\.event\.sessionCode/,
  );
  assert.match(settingsSource, /expectedSessionCode,\s*\}\);/);
});
