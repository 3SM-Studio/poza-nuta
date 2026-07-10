import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("event-scoped public request endpoint is anonymous and loads exactly the slugged event", () => {
  const routeSource = readFileSync(
    "src/app/api/public/events/[slug]/requests/route.ts",
    "utf8",
  );
  const legacyRouteSource = readFileSync(
    "src/app/api/public/requests/route.ts",
    "utf8",
  );
  const serviceSource = readFileSync("src/server/public-api/service.ts", "utf8");
  const createStart = serviceSource.indexOf(
    "export async function createPublicRequestForEventSlug",
  );
  const createEnd = serviceSource.indexOf("export const createPublicRequest");
  const createSource = serviceSource.slice(createStart, createEnd);

  assert.match(routeSource, /params: Promise<\{ slug: string \}>/);
  assert.match(routeSource, /createPublicRequestForEventSlug/);
  assert.doesNotMatch(routeSource, /requireOperatorSession|createServerClient|getUser|getSession/);
  assert.match(legacyRouteSource, /PUBLIC_REQUEST_ENDPOINT_GONE/);
  assert.match(legacyRouteSource, /410/);
  assert.doesNotMatch(legacyRouteSource, /createPublicRequest/);
  assert.doesNotMatch(legacyRouteSource, /validatePublicRequestInput/);
  assert.match(createSource, /where\(eq\(events\.slug, slug\)\)/);
  assert.match(createSource, /event\.visibility !== "public"/);
  assert.match(createSource, /event\.publishedAt/);
  assert.match(createSource, /songRequestsEnabled/);
  assert.match(serviceSource, /getEventPhase/);
  assert.match(createSource, /eventId: event\.id/);
  assert.doesNotMatch(createSource, /getActivePublicEvent/);
  assert.doesNotMatch(createSource, /DEFAULT_WORKSPACE_HANDLE/);
  assert.doesNotMatch(createSource, /isActivePublicEvent/);
  assert.doesNotMatch(createSource, /publicQueueEnabled/);
});

test("parallel live events are accepted independently and missing slug is rejected", () => {
  const eventA = { ...liveRequestEvent, slug: "karaoke-a", id: 101 };
  const eventB = { ...liveRequestEvent, slug: "karaoke-b", id: 202 };
  const serviceSource = readFileSync("src/server/public-api/service.ts", "utf8");
  const routeSource = readFileSync(
    "src/app/api/public/events/[slug]/requests/route.ts",
    "utf8",
  );

  assert.equal(canAcceptPublicRequests(eventA, referenceNow), true);
  assert.equal(canAcceptPublicRequests(eventB, referenceNow), true);
  assert.notEqual(eventA.id, eventB.id);
  assert.match(serviceSource, /eventId: event\.id/);
  assert.doesNotMatch(serviceSource, /limit\(1\);\s*const \[event\].*startsAt/s);
  assert.match(routeSource, /const \{ slug \} = await context\.params/);
  assert.match(serviceSource, /PUBLIC_EVENT_NOT_FOUND/);
});

test("public song search is global catalog search without active event selection", () => {
  const serviceSource = readFileSync("src/server/public-api/service.ts", "utf8");
  const searchStart = serviceSource.indexOf(
    "export async function searchPublicSongs",
  );
  const searchEnd = serviceSource.indexOf(
    "export async function createPublicRequestForEventSlug",
  );
  const searchSource = serviceSource.slice(searchStart, searchEnd);

  assert.match(searchSource, /\.from\(songs\)/);
  assert.match(searchSource, /ilike\(songs\.searchText, pattern\)/);
  assert.doesNotMatch(searchSource, /getActivePublicEvent/);
  assert.doesNotMatch(searchSource, /DEFAULT_WORKSPACE_HANDLE/);
  assert.doesNotMatch(searchSource, /isActivePublicEvent/);
  assert.doesNotMatch(searchSource, /from\(events\)/);
});

test("event page form submits requests to the scoped endpoint for the loaded event slug", () => {
  const pageSource = readFileSync("src/app/events/[slug]/page.tsx", "utf8");
  const formSource = readFileSync(
    "src/components/public/public-event-request-form.tsx",
    "utf8",
  );
  const clientSource = readFileSync("src/components/public/api.ts", "utf8");

  assert.match(pageSource, /getPublicEventBySlug\(slug/);
  assert.match(pageSource, /<PublicEventRequestForm/);
  assert.match(pageSource, /eventSlug=\{event\.slug\}/);
  assert.match(formSource, /createPublicRequest\(\{\s*eventSlug,/s);
  assert.match(
    clientSource,
    /`\/api\/public\/events\/\$\{encodeURIComponent\(input\.eventSlug\)\}\/requests`/,
  );
  assert.doesNotMatch(formSource, /getPublicEvent|getActivePublicEvent/);
});
