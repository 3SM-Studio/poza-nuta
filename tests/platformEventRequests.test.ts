import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { getEventPhase } from "../src/lib/event-phase.ts";
import { canAcceptPublicRequests } from "../src/lib/public-request-eligibility.ts";

const referenceNow = new Date("2026-07-10T18:00:00.000Z");
const publishedAt = new Date("2026-07-01T12:00:00.000Z");

const liveRequestEvent = {
  status: "active",
  visibility: "public",
  publishedAt,
  startsAt: new Date("2026-07-10T17:00:00.000Z"),
  endsAt: new Date("2026-07-10T23:00:00.000Z"),
  closedAt: null,
  songRequestsEnabled: true,
};

test("event phase is computed centrally from startsAt and endsAt", () => {
  assert.equal(
    getEventPhase(
      {
        ...liveRequestEvent,
        startsAt: new Date("2026-07-10T19:00:00.000Z"),
        endsAt: new Date("2026-07-11T01:00:00.000Z"),
      },
      referenceNow,
    ),
    "upcoming",
  );
  assert.equal(getEventPhase(liveRequestEvent, referenceNow), "live");
  assert.equal(
    getEventPhase(
      {
        ...liveRequestEvent,
        endsAt: new Date("2026-07-10T18:00:00.000Z"),
      },
      referenceNow,
    ),
    "ended",
  );
  assert.equal(
    getEventPhase({ ...liveRequestEvent, status: "cancelled" }, referenceNow),
    "cancelled",
  );
  assert.equal(
    getEventPhase(
      {
        ...liveRequestEvent,
        closedAt: new Date("2026-07-10T17:30:00.000Z"),
      },
      referenceNow,
    ),
    "ended",
  );
});

test("public request eligibility rejects upcoming ended cancelled private unpublished and disabled events", () => {
  assert.equal(
    canAcceptPublicRequests(
      {
        ...liveRequestEvent,
        startsAt: new Date("2026-07-10T19:00:00.000Z"),
        endsAt: new Date("2026-07-11T01:00:00.000Z"),
      },
      referenceNow,
    ),
    false,
  );
  assert.equal(canAcceptPublicRequests(liveRequestEvent, referenceNow), true);
  assert.equal(
    canAcceptPublicRequests(
      {
        ...liveRequestEvent,
        endsAt: new Date("2026-07-10T18:00:00.000Z"),
      },
      referenceNow,
    ),
    false,
  );
  assert.equal(
    canAcceptPublicRequests(
      { ...liveRequestEvent, status: "cancelled" },
      referenceNow,
    ),
    false,
  );
  assert.equal(
    canAcceptPublicRequests(
      { ...liveRequestEvent, visibility: "private" },
      referenceNow,
    ),
    false,
  );
  assert.equal(
    canAcceptPublicRequests(
      { ...liveRequestEvent, publishedAt: null },
      referenceNow,
    ),
    false,
  );
  assert.equal(
    canAcceptPublicRequests(
      { ...liveRequestEvent, songRequestsEnabled: false },
      referenceNow,
    ),
    false,
  );
});

test("songRequests true with liveQueue false still accepts requests", () => {
  assert.equal(canAcceptPublicRequests(liveRequestEvent, referenceNow), true);

  const contractSource = readFileSync(
    "src/lib/public-event-contract.ts",
    "utf8",
  );

  assert.match(contractSource, /songRequestsEnabled/);
  assert.match(contractSource, /publicQueueEnabled/);
  assert.equal(
    contractSource.includes("publicQueueEnabled: canAcceptPublicRequests"),
    false,
  );
});

test("public event slug does not expose a song request creation endpoint", () => {
  const legacyRouteSource = readFileSync(
    "src/app/api/public/requests/route.ts",
    "utf8",
  );
  const serviceSource = readFileSync("src/server/public-api/service.ts", "utf8");
  const clientSource = readFileSync("src/components/public/api.ts", "utf8");

  assert.equal(
    existsSync("src/app/api/public/events/[slug]/requests/route.ts"),
    false,
  );
  assert.match(legacyRouteSource, /PUBLIC_REQUEST_ENDPOINT_GONE/);
  assert.match(
    readFileSync("src/server/legacy-api.ts", "utf8"),
    /status: 410/,
  );
  assert.doesNotMatch(legacyRouteSource, /createPublicRequest/);
  assert.doesNotMatch(legacyRouteSource, /validatePublicRequestInput/);
  assert.doesNotMatch(serviceSource, /createPublicRequestForEventSlug/);
  assert.doesNotMatch(serviceSource, /export const createPublicRequest/);
  assert.doesNotMatch(clientSource, /createPublicRequest/);
  assert.doesNotMatch(clientSource, /\/api\/public\/events\/.*requests/);
});

test("parallel live events can be request-eligible without relying on global public queue visibility", () => {
  const eventA = { ...liveRequestEvent, slug: "karaoke-a", id: 101 };
  const eventB = { ...liveRequestEvent, slug: "karaoke-b", id: 202 };
  const queueHiddenEvent = { ...liveRequestEvent, publicQueueEnabled: false };

  assert.equal(canAcceptPublicRequests(eventA, referenceNow), true);
  assert.equal(canAcceptPublicRequests(eventB, referenceNow), true);
  assert.equal(canAcceptPublicRequests(queueHiddenEvent, referenceNow), true);
  assert.notEqual(eventA.id, eventB.id);
});

test("public song search is global catalog search without active event selection", () => {
  const serviceSource = readFileSync("src/server/public-api/service.ts", "utf8");
  const searchStart = serviceSource.indexOf(
    "export async function searchPublicSongs",
  );
  const searchEnd = serviceSource.indexOf(
    "function escapeLikePattern",
  );
  const searchSource = serviceSource.slice(searchStart, searchEnd);

  assert.match(searchSource, /\.from\(songs\)/);
  assert.match(searchSource, /ilike\(songs\.searchText, pattern\)/);
  assert.doesNotMatch(searchSource, /getActivePublicEvent/);
  assert.doesNotMatch(searchSource, /DEFAULT_WORKSPACE_HANDLE/);
  assert.doesNotMatch(searchSource, /isActivePublicEvent/);
  assert.doesNotMatch(searchSource, /from\(events\)/);
});

test("public event page is informational and does not render a request form", () => {
  const pageSource = readFileSync("src/app/events/[slug]/page.tsx", "utf8");

  assert.match(pageSource, /getPublicEventBySlug\(slug/);
  assert.match(pageSource, /kod QR/);
  assert.doesNotMatch(pageSource, /PublicEventRequestForm/);
  assert.doesNotMatch(pageSource, /createPublicRequest/);
  assert.doesNotMatch(pageSource, /searchPublicSongs/);
  assert.equal(
    existsSync("src/components/public/public-event-request-form.tsx"),
    false,
  );
});
