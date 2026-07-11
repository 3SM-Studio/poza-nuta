import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  getSessionEventAccessStatus,
  isValidSessionCodeFormat,
} from "../src/lib/session-event-access.ts";
import {
  canUseSessionPublicQueue,
  canUseSessionSongRequests,
  getSessionCapabilityState,
} from "../src/lib/session-capabilities.ts";
import { validateSessionRequestInput } from "../src/server/session-api/validation.ts";

const activeLink = {
  active: true,
  revokedAt: null,
};

const activeEvent = {
  status: "active",
  startsAt: new Date("2026-01-01T18:00:00.000Z"),
  autoCloseAt: new Date("2026-01-02T00:00:00.000Z"),
  endsAt: new Date("2026-01-02T00:00:00.000Z"),
  closedAt: null,
  publicQueueEnabled: true,
  songRequestsEnabled: true,
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

test("session access blocks scheduled and closed events without capability checks", () => {
  const queueHiddenEvent = { ...activeEvent, publicQueueEnabled: false };
  const requestDisabledEvent = { ...activeEvent, songRequestsEnabled: false };

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
      event: { ...activeEvent, status: "cancelled" },
      now: new Date("2026-01-01T19:00:00.000Z"),
    }),
    "closed",
  );
  assert.equal(
    getSessionEventAccessStatus({
      link: activeLink,
      event: queueHiddenEvent,
      now: new Date("2026-01-01T19:00:00.000Z"),
    }),
    "active",
  );
  assert.equal(
    getSessionEventAccessStatus({
      link: activeLink,
      event: requestDisabledEvent,
      now: new Date("2026-01-01T19:00:00.000Z"),
    }),
    "active",
  );
});

test("session capabilities keep song requests and public queue independent", () => {
  assert.deepEqual(
    getSessionCapabilityState({
      songRequestsEnabled: true,
      publicQueueEnabled: true,
    }),
    {
      canSearchSongs: true,
      canSubmitSongRequests: true,
      canViewPublicQueue: true,
      allSessionFeaturesDisabled: false,
    },
  );
  assert.deepEqual(
    getSessionCapabilityState({
      songRequestsEnabled: true,
      publicQueueEnabled: false,
    }),
    {
      canSearchSongs: true,
      canSubmitSongRequests: true,
      canViewPublicQueue: false,
      allSessionFeaturesDisabled: false,
    },
  );
  assert.deepEqual(
    getSessionCapabilityState({
      songRequestsEnabled: false,
      publicQueueEnabled: true,
    }),
    {
      canSearchSongs: false,
      canSubmitSongRequests: false,
      canViewPublicQueue: true,
      allSessionFeaturesDisabled: false,
    },
  );
  assert.deepEqual(
    getSessionCapabilityState({
      songRequestsEnabled: false,
      publicQueueEnabled: false,
    }),
    {
      canSearchSongs: false,
      canSubmitSongRequests: false,
      canViewPublicQueue: false,
      allSessionFeaturesDisabled: true,
    },
  );
  assert.equal(
    canUseSessionSongRequests({
      songRequestsEnabled: true,
      publicQueueEnabled: false,
    }),
    true,
  );
  assert.equal(
    canUseSessionPublicQueue({
      songRequestsEnabled: false,
      publicQueueEnabled: true,
    }),
    true,
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
  const end = source.indexOf("async function requireLiveSession");
  const createSource = source.slice(start, end);

  assert.match(createSource, /eventId: session\.event\.id/);
  assert.doesNotMatch(createSource, /input\.eventId/);
});

test("session API request flow is anonymous and code-scoped", () => {
  const requestRouteSource = readFileSync(
    new URL("../src/app/api/session/[code]/requests/route.ts", import.meta.url),
    "utf8",
  );
  const eventRouteSource = readFileSync(
    new URL("../src/app/api/session/[code]/event/route.ts", import.meta.url),
    "utf8",
  );
  const searchRouteSource = readFileSync(
    new URL(
      "../src/app/api/session/[code]/songs/search/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const queueRouteSource = readFileSync(
    new URL("../src/app/api/session/[code]/queue/route.ts", import.meta.url),
    "utf8",
  );
  const serviceSource = readFileSync(
    new URL("../src/server/session-api/service.ts", import.meta.url),
    "utf8",
  );
  const clientSource = readFileSync(
    new URL("../src/components/public/session-api.ts", import.meta.url),
    "utf8",
  );

  assert.match(requestRouteSource, /params: Promise<\{ code: string \}>/);
  assert.match(requestRouteSource, /createSessionRequest\(code, validation\.data\)/);
  assert.match(eventRouteSource, /getSessionEvent\(code\)/);
  assert.match(searchRouteSource, /searchSessionSongs\(code, validation\.data\)/);
  assert.match(queueRouteSource, /getSessionQueue\(code\)/);
  assert.doesNotMatch(
    requestRouteSource,
    /requireOperatorSession|createServerClient|getUser|getSession/,
  );
  assert.match(serviceSource, /hashEventAccessCode\(code\)/);
  assert.match(serviceSource, /innerJoin\(events, eq\(events\.id, eventAccessLinks\.eventId\)\)/);
  assert.match(serviceSource, /eventId: session\.event\.id/);
  assert.match(serviceSource, /where\(eq\(songRequests\.eventId, session\.event\.id\)\)/);
  assert.match(serviceSource, /getSessionEvent\(code: string\)[\s\S]*requireLiveSession\(code\)/);
  assert.match(serviceSource, /searchSessionSongs\([\s\S]*requireSongRequestSession\(code\)/);
  assert.match(serviceSource, /getSessionQueue\(code: string\)[\s\S]*requireLiveSession\(code\)/);
  assert.match(serviceSource, /createSessionRequest\([\s\S]*requireSongRequestSessionInTransaction/);
  assert.match(serviceSource, /if \(!canUseSessionPublicQueue\(session\.event\)\)/);
  assert.match(serviceSource, /enabled: false as const/);
  assert.match(serviceSource, /if \(!canUseSessionSongRequests\(row\.event\)\)/);
  assert.match(serviceSource, /SESSION_PUBLIC_REQUESTS_DISABLED/);
  assert.doesNotMatch(serviceSource, /input\.eventId/);
  assert.doesNotMatch(serviceSource, /getActivePublicEvent/);
  assert.match(clientSource, /\/api\/session\/\$\{encodeURIComponent\(code\)\}\/requests/);
  assert.match(clientSource, /\/api\/session\/\$\{encodeURIComponent\(code\)\}\/songs\/search/);
  assert.match(clientSource, /\/api\/session\/\$\{encodeURIComponent\(code\)\}\/queue/);
});

test("session UI gates search form queue fetches and realtime by capability", () => {
  const pageSource = readFileSync(
    new URL("../src/components/public/session-request-page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /getSessionCapabilityState\(event\)/);
  assert.match(pageSource, /const canSubmitSongRequests = capabilities\.canSubmitSongRequests/);
  assert.match(pageSource, /const canViewPublicQueue = capabilities\.canViewPublicQueue/);
  assert.match(pageSource, /\{canSubmitSongRequests \? \(/);
  assert.match(pageSource, /\{canViewPublicQueue \? \(/);
  assert.match(pageSource, /if \(!canViewPublicQueue\) \{\s*return;\s*\}/);
  assert.match(pageSource, /usePublicQueueRealtime\(\s*canViewPublicQueue \? event\.id : null/s);
  assert.match(pageSource, /capabilities\.allSessionFeaturesDisabled/);
});

test("parallel session codes keep requests isolated by resolved event", () => {
  const source = readFileSync(
    new URL("../src/server/session-api/service.ts", import.meta.url),
    "utf8",
  );
  const lookupStart = source.indexOf("async function findSessionEventByCodeInTransaction");
  const lookupEnd = source.indexOf("function toPublicSessionEvent");
  const lookupSource = source.slice(lookupStart, lookupEnd);
  const createStart = source.indexOf("export async function createSessionRequest");
  const createEnd = source.indexOf("async function requireLiveSession");
  const createSource = source.slice(createStart, createEnd);

  assert.match(lookupSource, /hashEventAccessCode\(code\)/);
  assert.match(lookupSource, /where\(eq\(eventAccessLinks\.codeHash, codeHash\)\)/);
  assert.match(lookupSource, /innerJoin\(events, eq\(events\.id, eventAccessLinks\.eventId\)\)/);
  assert.match(createSource, /const session = await requireSongRequestSessionInTransaction\(\s*transaction,\s*code,\s*\)/s);
  assert.match(createSource, /eventId: session\.event\.id/);
  assert.match(createSource, /where\(eq\(songRequests\.eventId, session\.event\.id\)\)/);
});

test("global public queue route is a tombstone and session queue remains canonical", () => {
  const pagePath = new URL("../src/app/queue/page.tsx", import.meta.url);
  const routeSource = readFileSync(
    new URL("../src/app/api/public/queue/route.ts", import.meta.url),
    "utf8",
  );

  assert.equal(existsSync(pagePath), false);
  assert.match(routeSource, /PUBLIC_QUEUE_ENDPOINT_GONE/);
  assert.doesNotMatch(routeSource, /getPublicQueue/);
});
