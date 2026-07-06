import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getSessionEventAccessStatus,
  isValidSessionCodeFormat,
} from "../src/lib/session-event-access.ts";
import { validateSessionRequestInput } from "../src/server/session-api/validation.ts";

const activeLink = {
  active: true,
  revokedAt: null,
};

const activeEvent = {
  status: "active",
  startsAt: new Date("2026-01-01T18:00:00.000Z"),
  autoCloseAt: new Date("2026-01-02T00:00:00.000Z"),
  closedAt: null,
  publicQueueEnabled: true,
};

test("session codes require URL-safe bearer-token format", () => {
  assert.equal(isValidSessionCodeFormat("abc123_-ABCxyz789"), true);
  assert.equal(isValidSessionCodeFormat("123456"), false);
  assert.equal(isValidSessionCodeFormat("abc123"), false);
  assert.equal(isValidSessionCodeFormat("abc123+not-url-safe"), false);
});

test("session access rejects invalid, revoked and inactive links", () => {
  assert.equal(
    getSessionEventAccessStatus({
      link: null,
      event: activeEvent,
      now: new Date("2026-01-01T19:00:00.000Z"),
    }),
    "invalid",
  );
  assert.equal(
    getSessionEventAccessStatus({
      link: { active: false, revokedAt: null },
      event: activeEvent,
      now: new Date("2026-01-01T19:00:00.000Z"),
    }),
    "invalid",
  );
  assert.equal(
    getSessionEventAccessStatus({
      link: { active: true, revokedAt: new Date("2026-01-01T19:00:00.000Z") },
      event: activeEvent,
      now: new Date("2026-01-01T19:00:00.000Z"),
    }),
    "invalid",
  );
});

test("session access blocks scheduled, closed and disabled events", () => {
  assert.equal(
    getSessionEventAccessStatus({
      link: activeLink,
      event: activeEvent,
      now: new Date("2026-01-01T17:59:00.000Z"),
    }),
    "scheduled",
  );
  assert.equal(
    getSessionEventAccessStatus({
      link: activeLink,
      event: activeEvent,
      now: new Date("2026-01-02T00:00:00.000Z"),
    }),
    "closed",
  );
  assert.equal(
    getSessionEventAccessStatus({
      link: activeLink,
      event: { ...activeEvent, status: "closed" },
      now: new Date("2026-01-01T19:00:00.000Z"),
    }),
    "closed",
  );
  assert.equal(
    getSessionEventAccessStatus({
      link: activeLink,
      event: { ...activeEvent, publicQueueEnabled: false },
      now: new Date("2026-01-01T19:00:00.000Z"),
    }),
    "disabled",
  );
});

test("session access allows active event without requiring global active public event", () => {
  assert.equal(
    getSessionEventAccessStatus({
      link: activeLink,
      event: activeEvent,
      now: new Date("2026-01-01T19:00:00.000Z"),
    }),
    "active",
  );
});

test("session request validation requires a requester nickname", () => {
  assert.deepEqual(validateSessionRequestInput({ songId: 42 }), {
    success: false,
    issues: [
      {
        field: "requesterName",
        message: "requesterName must contain at least 2 characters.",
      },
    ],
  });
  assert.deepEqual(
    validateSessionRequestInput({ songId: 42, requesterName: "   " }),
    {
      success: false,
      issues: [
        {
          field: "requesterName",
          message: "requesterName must contain at least 2 characters.",
        },
      ],
    },
  );
});

test("session request validation stores a trimmed requester nickname", () => {
  assert.deepEqual(
    validateSessionRequestInput({
      songId: 42,
      requesterName: "  Kasia  ",
    }),
    {
      success: true,
      data: {
        songId: 42,
        singerName: "Kasia",
        note: null,
      },
    },
  );
});

test("dashboard session link generation is limited to event managers and revokes previous links", () => {
  const source = readFileSync(
    new URL("../src/server/operator-api/organizations.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function generateDashboardOrganizationEventSessionLinkForAuthUser",
  );
  const end = source.indexOf(
    "export async function generateDashboardOrganizationEventShareLinkForAuthUser",
  );
  const generateSource = source.slice(start, end);

  assert.match(generateSource, /requireEventManagerOrganizationEventInTransaction/);
  assert.doesNotMatch(generateSource, /requireEventSharerOrganizationEventInTransaction/);
});

test("dashboard share link generation allows owner manager and operator without reading plaintext from hash", () => {
  const source = readFileSync(
    new URL("../src/server/operator-api/organizations.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function generateDashboardOrganizationEventShareLinkForAuthUser",
  );
  const end = source.indexOf(
    "export async function createDashboardOrganizationEventForAuthUser",
  );
  const shareSource = source.slice(start, end);
  const helperStart = source.indexOf("async function createEventSessionLinkInTransaction");
  const helperEnd = source.indexOf("async function requireOwnerOrganizationInTransaction");
  const helperSource = source.slice(helperStart, helperEnd);

  assert.match(source, /canShareDashboardOrganizationEvent/);
  assert.match(source, /role === "operator"/);
  assert.match(shareSource, /requireEventSharerOrganizationEventInTransaction/);
  assert.match(helperSource, /update\(eventAccessLinks\)/);
  assert.match(helperSource, /active: false/);
  assert.match(helperSource, /revokedAt: now/);
  assert.match(helperSource, /insert\(eventAccessLinks\)/);
  assert.match(helperSource, /hashEventAccessCode\(code\)/);
  assert.doesNotMatch(helperSource, /codeHash: code/);
  assert.doesNotMatch(shareSource, /select\(\{[^}]*codeHash/s);
});

test("dashboard session link creation revokes previous links", () => {
  const source = readFileSync(
    new URL("../src/server/operator-api/organizations.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function createEventSessionLinkInTransaction");
  const end = source.indexOf("async function requireOwnerOrganizationInTransaction");
  const generateSource = source.slice(start, end);

  assert.match(generateSource, /update\(eventAccessLinks\)/);
  assert.match(generateSource, /active: false/);
  assert.match(generateSource, /revokedAt: now/);
  assert.match(generateSource, /insert\(eventAccessLinks\)/);
  assert.match(generateSource, /hashEventAccessCode\(code\)/);
  assert.doesNotMatch(generateSource, /codeHash: code/);
});

test("session request creation writes to the event resolved from the code", () => {
  const source = readFileSync(
    new URL("../src/server/session-api/service.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function createSessionRequest");
  const end = source.indexOf("async function requireActiveSession");
  const createSource = source.slice(start, end);

  assert.match(createSource, /eventId: session\.event\.id/);
  assert.doesNotMatch(createSource, /input\.eventId/);
});

test("global public queue route remains wired to the public queue flow", () => {
  const pageSource = readFileSync(
    new URL("../src/app/queue/page.tsx", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(
    new URL("../src/app/api/public/queue/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /PublicQueuePage/);
  assert.match(routeSource, /getPublicQueue/);
});
