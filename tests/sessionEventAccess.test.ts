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
import {
  encodeSongBrowseCursor,
  getSongBrowseFilterKey,
  validateParticipantSessionRequestInput,
  validatePublicSongBrowseQuery,
} from "../src/server/session-api/validation.ts";

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

test("participant request validation accepts only a server-owned song selection", () => {
  assert.deepEqual(validateParticipantSessionRequestInput({ songId: 1 }), {
    success: true,
    data: { songId: 1 },
  });
  for (const field of ["requesterName", "singerName", "displayName", "eventId"]) {
    const result = validateParticipantSessionRequestInput({
      songId: 1,
      [field]: "Admin",
    });
    assert.equal(result.success, false);
  }
});

test("song browse validation keeps catalog pagination bounded and filter-bound", () => {
  const defaultQuery = validatePublicSongBrowseQuery(new URLSearchParams());
  assert.deepEqual(defaultQuery, {
    success: true,
    data: {
      cursor: null,
      limit: 24,
      q: null,
      genre: null,
      language: null,
      duet: false,
      hit: false,
      sort: "title",
    },
  });

  const cappedQuery = validatePublicSongBrowseQuery(
    new URLSearchParams({
      limit: "999",
      q: "  Maanam  ",
      genre: "Pop",
      language: "Polish",
      duet: "true",
      hit: "true",
      sort: "artist",
    }),
  );
  assert.equal(cappedQuery.success, true);
  if (!cappedQuery.success) return;
  assert.equal(cappedQuery.data.limit, 40);
  assert.equal(cappedQuery.data.q, "maanam");
  assert.equal(cappedQuery.data.genre, "pop");
  assert.equal(cappedQuery.data.language, "polish");
  assert.equal(cappedQuery.data.duet, true);
  assert.equal(cappedQuery.data.hit, true);
  assert.equal(cappedQuery.data.sort, "artist");

  const cursor = encodeSongBrowseCursor({
    version: 1,
    filterKey: getSongBrowseFilterKey(cappedQuery.data),
    sort: "artist",
    id: 11,
    normalizedTitle: "boskie buenos",
    normalizedArtist: "maanam",
  });
  const paginated = validatePublicSongBrowseQuery(
    new URLSearchParams({
      limit: "24",
      q: "Maanam",
      genre: "pop",
      language: "polish",
      duet: "true",
      hit: "true",
      sort: "artist",
      cursor,
    }),
  );
  assert.equal(paginated.success, true);
  if (paginated.success) assert.equal(paginated.data.cursor?.id, 11);

  assert.equal(
    validatePublicSongBrowseQuery(
      new URLSearchParams({ cursor: "not-a-valid-cursor" }),
    ).success,
    false,
  );
  assert.equal(
    validatePublicSongBrowseQuery(new URLSearchParams({ sort: "random" })).success,
    false,
  );
  assert.equal(
    validatePublicSongBrowseQuery(new URLSearchParams({ limit: "0" })).success,
    false,
  );
});

test("session resolver uses one token/code identity service and locks writes", () => {
  const source = readFileSync("src/server/session-api/service.ts", "utf8");
  const transactionLookup = source.slice(
    source.indexOf("async function findSessionEventInTransaction"),
    source.indexOf("function toPublicSessionEvent"),
  );

  assert.match(source, /eq\(eventSessions\.publicToken, lookup\.value\)/);
  assert.match(source, /eq\(eventSessionCodes\.code, lookup\.value\)/);
  assert.match(source, /canResolveEventJoinCode/);
  assert.doesNotMatch(source, /hashEventAccessCode/);
  assert.doesNotMatch(source, /from\(eventAccessLinks\)/);
  assert.match(transactionLookup, /\.from\(eventSessions\)/);
  assert.match(transactionLookup, /\.for\("update"\)/);
  assert.match(source, /SESSION_EVENT_CLOSED/);
  assert.match(source, /SESSION_EVENT_NOT_STARTED/);
});

test("public session DTOs exclude internal relational identifiers", () => {
  const service = readFileSync("src/server/session-api/service.ts", "utf8");
  const publicEventType = service.slice(
    service.indexOf("export type PublicSessionEvent"),
    service.indexOf("export async function resolveSessionEventAccess"),
  );
  const publicEventMapper = service.slice(
    service.indexOf("function toPublicSessionEvent"),
    service.indexOf("function escapeLikePattern"),
  );
  const requestWriter = service.slice(
    service.indexOf("export async function createPublicSessionRequest"),
    service.indexOf("async function requireLiveSession"),
  );

  assert.doesNotMatch(publicEventType, /\bid:\s*number/);
  assert.doesNotMatch(publicEventMapper, /\bid:\s*event\.id/);
  assert.doesNotMatch(
    requestWriter,
    /\beventId:\s*songRequests\.eventId|\bsongId:\s*songRequests\.songId/,
  );
  assert.match(requestWriter, /status:\s*songRequests\.status/);
});

test("participant request duplicate protection is serialized by the event lock", () => {
  const source = readFileSync("src/server/session-api/service.ts", "utf8");
  const createRequest = source.slice(
    source.indexOf("export async function createPublicSessionRequest"),
    source.indexOf("async function requireLiveSession"),
  );

  assert.match(
    createRequest,
    /requireSongRequestSessionInTransaction\(transaction,\s*\{\s*kind: "token",\s*value: publicToken/,
  );
  assert.match(createRequest, /eq\(songRequests\.songId, song\.id\)/);
  assert.match(
    createRequest,
    /eq\(songRequests\.eventParticipantId, membership\.id\)/,
  );
  assert.match(
    createRequest,
    /inArray\(songRequests\.status, ACTIVE_PUBLIC_REQUEST_STATUSES\)/,
  );
  assert.match(createRequest, /SESSION_REQUEST_DUPLICATE/);
  assert.ok(
    createRequest.indexOf("SESSION_REQUEST_DUPLICATE") <
      createRequest.indexOf(".insert(songRequests)"),
  );
});

test("session API remains anonymous, identity-scoped and rate limited", () => {
  const routes = [
    "src/app/api/session/[code]/event/route.ts",
    "src/app/api/session/[code]/songs/search/route.ts",
    "src/app/api/session/[code]/queue/route.ts",
    "src/app/api/s/[token]/event/route.ts",
    "src/app/api/s/[token]/songs/search/route.ts",
    "src/app/api/s/[token]/songs/browse/route.ts",
    "src/app/api/s/[token]/songs/discovery/route.ts",
    "src/app/api/s/[token]/requests/route.ts",
    "src/app/api/s/[token]/queue/route.ts",
    "src/app/api/s/[token]/join/route.ts",
    "src/app/api/s/[token]/participant/route.ts",
  ];

  for (const route of routes) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /requireSessionApiRateLimit\(request\)/);
    assert.doesNotMatch(source, /requireOperatorSession/);
  }

  const legacyMutation = readFileSync(
    "src/app/api/session/[code]/requests/route.ts",
    "utf8",
  );
  assert.match(legacyMutation, /legacyGoneResponse/);
  assert.match(legacyMutation, /SESSION_REQUEST_ENDPOINT_GONE/);
  assert.doesNotMatch(legacyMutation, /request\.json|createSessionRequest/);
});

test("canonical session page and code resolver provide safe states", () => {
  const page = readFileSync("src/app/s/[token]/page.tsx", "utf8");
  const resolver = readFileSync(
    "src/server/session-api/code-resolver-response.ts",
    "utf8",
  );
  const alert = readFileSync(
    "src/components/public/session-state-alert.tsx",
    "utf8",
  );
  assert.match(page, /consumeSessionRequestRateLimit/);
  assert.match(page, /rate_limited/);
  assert.match(page, /SessionStateAlert/);
  assert.match(page, /notFound\(\)/);
  assert.match(resolver, /status: 307/);
  assert.match(resolver, /no-store/);
  assert.match(alert, /Sesja jeszcze się nie rozpoczęła/);
  assert.match(alert, /Sesja została zakończona/);
  assert.match(alert, /Nieprawidłowy kod sesji/);
  assert.doesNotMatch(alert, /wygasł/);
});

test("song discovery does not burst concurrent catalog queries", () => {
  const source = readFileSync("src/server/session-api/service.ts", "utf8");
  const discoverySource = source.slice(
    source.indexOf("export async function getPublicSessionSongDiscovery"),
    source.indexOf("export async function browsePublicSessionSongs"),
  );

  assert.doesNotMatch(discoverySource, /Promise\.all\(/);
  assert.match(discoverySource, /await listSongDiscoveryCategories\(songs\.genres\)/);
  assert.match(
    discoverySource,
    /await listSongDiscoveryCategories\(songs\.languages\)/,
  );
  assert.match(discoverySource, /const featureRows = await getDb\(\)/);
});

test("canonical session pages reuse one resolved session lookup", () => {
  for (const pagePath of [
    "src/app/s/[token]/page.tsx",
    "src/app/s/[token]/songs/page.tsx",
  ]) {
    const page = readFileSync(pagePath, "utf8");

    assert.match(page, /getPublicSessionPageData\(/);
    assert.match(page, /isTransientInfrastructureError\(error\)/);
    assert.match(page, /service_unavailable/);
    assert.doesNotMatch(page, /resolvePublicSessionEventAccess\(/);
    assert.doesNotMatch(page, /getPublicSessionParticipant\(/);
    assert.doesNotMatch(page, /getPublicSessionSongDiscovery\(/);
  }
});

test("session entry form normalizes paste and preserves a leading zero", () => {
  const form = readFileSync("src/components/public/session-code-form.tsx", "utf8");
  assert.match(form, /normalizeSessionCode\(code\)/);
  assert.match(form, /isCanonicalSessionCode\(normalized\)/);
  assert.match(form, /router\.push\(`\$\{destinationBasePath\}\/\$\{normalized\}`\)/);
  assert.match(form, /destinationBasePath = "\/join"/);
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

test("organizer QR uses a responsive Tailwind layout without HTML injection", () => {
  const panel = readFileSync(
    "src/components/operator/event-session-access-panel.tsx",
    "utf8",
  );
  assert.match(panel, /createBrandedSessionQrSvg\(sessionUrl\)/);
  assert.match(panel, /Kopiuj kod/);
  assert.match(panel, /Kopiuj link/);
  assert.match(panel, /Pobierz QR \(SVG\)/);
  assert.doesNotMatch(panel, /useActionState/);
  assert.doesNotMatch(panel, /Regeneruj|Wygeneruj/);
  assert.match(panel, /grid min-w-0 grid-cols-1/);
  assert.match(panel, /aspect-square w-full min-w-0 max-w-sm/);
  assert.match(panel, /className="block h-auto w-full max-w-full"/);
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML|operator\.module\.css/);
});

test("legacy manual link UI and endpoints are absent", () => {
  assert.equal(existsSync("src/components/operator/event-share-panel.tsx"), false);
  assert.equal(existsSync("src/components/operator/event-access-links-panel.tsx"), false);
  assert.equal(existsSync("src/app/api/dashboard/event/access-links/route.ts"), false);
});
