import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  canUseSessionPublicQueue,
  canUseSessionSongRequests,
  getSessionCapabilityState,
} from "../src/lib/session-capabilities.ts";
import {
  getSessionEventAccessStatus,
  isValidSessionCodeFormat,
} from "../src/lib/session-event-access.ts";
import {
  consumeSessionRateLimit,
  resetSessionRateLimitForTests,
} from "../src/server/session-api/rate-limit-core.ts";
import { validateSessionRequestInput } from "../src/server/session-api/validation.ts";

const now = new Date("2026-07-18T18:00:00.000Z");
const activeEvent = {
  status: "active",
  startsAt: new Date("2026-07-18T17:00:00.000Z"),
  autoCloseAt: new Date("2026-07-18T23:00:00.000Z"),
  endsAt: new Date("2026-07-18T23:00:00.000Z"),
  closedAt: null,
};

test("session codes require exactly eight digits and preserve leading zero", () => {
  assert.equal(isValidSessionCodeFormat("01234567"), true);
  assert.equal(isValidSessionCodeFormat("1234567"), false);
  assert.equal(isValidSessionCodeFormat("1234-5678"), false);
  assert.equal(isValidSessionCodeFormat("abcdefgh"), false);
});

test("session access uses one effective lifecycle contract", () => {
  assert.equal(getSessionEventAccessStatus({ event: null, now }), "invalid");
  assert.equal(
    getSessionEventAccessStatus({
      event: {
        ...activeEvent,
        startsAt: new Date("2026-07-18T19:00:00.000Z"),
      },
      now,
    }),
    "scheduled",
  );
  assert.equal(getSessionEventAccessStatus({ event: activeEvent, now }), "active");
  assert.equal(
    getSessionEventAccessStatus({
      event: {
        ...activeEvent,
        autoCloseAt: new Date("2026-07-18T18:00:00.000Z"),
      },
      now,
    }),
    "closed",
  );
  assert.equal(
    getSessionEventAccessStatus({
      event: {
        ...activeEvent,
        status: "closed",
        closedAt: new Date("2026-07-18T17:30:00.000Z"),
      },
      now,
    }),
    "closed",
  );
  assert.equal(
    getSessionEventAccessStatus({
      event: { ...activeEvent, status: "cancelled" },
      now,
    }),
    "closed",
  );
});

test("session capabilities keep requests and public queue independent", () => {
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
  assert.equal(
    canUseSessionSongRequests({
      songRequestsEnabled: false,
      publicQueueEnabled: true,
    }),
    false,
  );
  assert.equal(
    canUseSessionPublicQueue({
      songRequestsEnabled: false,
      publicQueueEnabled: true,
    }),
    true,
  );
});

test("session request validation requires and trims a nickname", () => {
  assert.equal(
    validateSessionRequestInput({ songId: 1, singerName: " " }).success,
    false,
  );
  assert.deepEqual(
    validateSessionRequestInput({
      songId: 1,
      singerName: "  Ala  ",
      note: "  duet  ",
    }),
    {
      success: true,
      data: { songId: 1, singerName: "Ala", note: "duet" },
    },
  );
});

test("session resolver reads the canonical event code and locks writes", () => {
  const source = readFileSync("src/server/session-api/service.ts", "utf8");
  const transactionLookup = source.slice(
    source.indexOf("async function findSessionEventByCodeInTransaction"),
    source.indexOf("function toPublicSessionEvent"),
  );

  assert.match(source, /eq\(events\.sessionCode, code\)/);
  assert.doesNotMatch(source, /hashEventAccessCode/);
  assert.doesNotMatch(source, /from\(eventAccessLinks\)/);
  assert.match(transactionLookup, /\.from\(events\)/);
  assert.match(transactionLookup, /\.for\("update"\)/);
  assert.match(source, /SESSION_EVENT_CLOSED/);
  assert.match(source, /SESSION_EVENT_NOT_STARTED/);
});

test("session request duplicate protection is serialized by the event lock", () => {
  const source = readFileSync("src/server/session-api/service.ts", "utf8");
  const createRequest = source.slice(
    source.indexOf("export async function createSessionRequest"),
    source.indexOf("async function requireLiveSession"),
  );

  assert.match(
    createRequest,
    /requireSongRequestSessionInTransaction\(\s*transaction,\s*code/,
  );
  assert.match(createRequest, /eq\(songRequests\.songId, song\.id\)/);
  assert.match(
    createRequest,
    /lower\(\$\{songRequests\.displayName\}\) = lower\(\$\{input\.singerName\}\)/,
  );
  assert.match(
    createRequest,
    /inArray\(songRequests\.status, ACTIVE_SESSION_REQUEST_STATUSES\)/,
  );
  assert.match(createRequest, /SESSION_REQUEST_DUPLICATE/);
  assert.ok(
    createRequest.indexOf("SESSION_REQUEST_DUPLICATE") <
      createRequest.indexOf(".insert(songRequests)"),
  );
});

test("session API remains anonymous, code-scoped and rate limited", () => {
  const routes = [
    "src/app/api/session/[code]/event/route.ts",
    "src/app/api/session/[code]/songs/search/route.ts",
    "src/app/api/session/[code]/requests/route.ts",
    "src/app/api/session/[code]/queue/route.ts",
  ];

  for (const route of routes) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /requireSessionApiRateLimit\(request\)/);
    assert.doesNotMatch(source, /requireOperatorSession/);
  }
});

test("session page provides neutral invalid state and canonical status copy", () => {
  const page = readFileSync("src/app/session/[code]/page.tsx", "utf8");
  const alert = readFileSync(
    "src/components/public/session-state-alert.tsx",
    "utf8",
  );
  assert.match(page, /consumeSessionRequestRateLimit/);
  assert.match(page, /rate_limited/);
  assert.match(page, /SessionStateAlert/);
  assert.match(alert, /Sesja jeszcze się nie rozpoczęła/);
  assert.match(alert, /Sesja została zakończona/);
  assert.match(alert, /Nieprawidłowy kod sesji/);
  assert.doesNotMatch(alert, /wygasł/);
});

test("session entry form normalizes paste and preserves a leading zero", () => {
  const form = readFileSync("src/components/public/session-code-form.tsx", "utf8");
  assert.match(form, /normalizeSessionCode\(code\)/);
  assert.match(form, /isCanonicalSessionCode\(normalized\)/);
  assert.match(form, /router\.push\(`\/session\/\$\{normalized\}`\)/);
  assert.match(form, /REGEXP_ONLY_DIGITS/);
  assert.match(form, /<InputOTP/);
  assert.equal((form.match(/<InputOTPGroup>/g) ?? []).length, 2);
  assert.match(form, /<InputOTPSeparator/);
  assert.match(form, /inputMode="numeric"/);
});

test("session rate limiting is bounded by scope", () => {
  resetSessionRateLimitForTests();
  const attempts = Array.from({ length: 12 }, () =>
    consumeSessionRateLimit({ scope: "page", key: "example", now: 1_000 }),
  );
  assert.equal(attempts.every((attempt) => attempt.allowed), true);
  assert.equal(
    consumeSessionRateLimit({ scope: "page", key: "example", now: 1_000 })
      .allowed,
    false,
  );
  assert.equal(
    consumeSessionRateLimit({ scope: "page", key: "example", now: 61_000 })
      .allowed,
    true,
  );
});

test("organizer QR uses the canonical session URL without a generator", () => {
  const panel = readFileSync(
    "src/components/operator/event-session-access-panel.tsx",
    "utf8",
  );
  assert.match(panel, /QRCode\.toCanvas\(canvas, sessionUrl/);
  assert.match(panel, /Kopiuj kod/);
  assert.match(panel, /Kopiuj link/);
  assert.match(panel, /Pobierz QR/);
  assert.doesNotMatch(panel, /useActionState/);
  assert.doesNotMatch(panel, /Regeneruj|Wygeneruj/);
});

test("legacy manual link UI and endpoints are absent", () => {
  assert.equal(existsSync("src/components/operator/event-share-panel.tsx"), false);
  assert.equal(existsSync("src/components/operator/event-access-links-panel.tsx"), false);
  assert.equal(existsSync("src/app/api/dashboard/event/access-links/route.ts"), false);
});
