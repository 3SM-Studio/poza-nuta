import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  buildEventSlugCollisionCandidate,
  formatEventSlug,
  isValidEventSlug,
} from "../src/lib/event-slug.ts";
import { isEventSlugUniqueViolation } from "../src/lib/event-slug-db-error.ts";
import {
  getPublicEventDateRange,
  getWarsawWeekendRange,
  isInWarsawWeekend,
  normalizePublicEventsQuery,
} from "../src/lib/public-event-discovery.ts";
import { toPublicEventContract } from "../src/lib/public-event-contract.ts";
import { canAcceptPublicRequests } from "../src/lib/public-request-eligibility.ts";
import { validateUpdateDashboardEventDetailsInput } from "../src/server/operator-api/validation.ts";

test("event slug helper normalizes names and appends ids only for collisions", () => {
  assert.equal(formatEventSlug("  Łódź Karaoke: Zażółć gęślą jaźń!  "), "lodz-karaoke-zazolc-gesla-jazn");
  assert.equal(isValidEventSlug("karaoke-night-2026"), true);
  assert.equal(isValidEventSlug("-karaoke"), false);
  assert.equal(isValidEventSlug("karaoke--night"), false);

  assert.equal(
    buildEventSlugCollisionCandidate({
      baseSlug: "karaoke-night",
      eventId: 123,
    }),
    "karaoke-night-123",
  );
});

test("dashboard event validation accepts catalog fields and defaults to private", () => {
  const privateEvent = validateUpdateDashboardEventDetailsInput({
    title: "Karaoke Night",
    venue: "Klub",
    city: "Warszawa",
    slug: "",
    startsAt: "2026-07-05T19:00",
    autoCloseAt: "2026-07-06T01:00",
  });

  assert.equal(privateEvent.success, true);
  assert.equal(privateEvent.success ? privateEvent.data.city : null, "Warszawa");
  assert.equal(privateEvent.success ? privateEvent.data.slug : null, null);
  assert.equal(privateEvent.success ? privateEvent.data.visibility : null, "private");

  const publicEvent = validateUpdateDashboardEventDetailsInput({
    title: "Karaoke Night",
    venue: "Klub",
    city: "Warszawa",
    slug: "Karaoke Night",
    visibility: "public",
    startsAt: "2026-07-05T19:00",
    autoCloseAt: "2026-07-06T01:00",
  });

  assert.equal(publicEvent.success, true);
  assert.equal(publicEvent.success ? publicEvent.data.slug : null, "karaoke-night");
  assert.equal(publicEvent.success ? publicEvent.data.visibility : null, "public");
});

test("public event contract exposes only public fields and computes status", () => {
  const now = new Date("2026-07-09T18:00:00.000Z");
  const baseEvent = {
    id: 10,
    name: "Karaoke Night",
    slug: "karaoke-night",
    venue: "Klub",
    city: "Warszawa",
    startsAt: new Date("2026-07-09T17:00:00.000Z"),
    endsAt: new Date("2026-07-09T23:00:00.000Z"),
    closedAt: null,
    status: "active",
    visibility: "public",
    publishedAt: new Date("2026-07-01T12:00:00.000Z"),
    songRequestsEnabled: true,
    publicQueueEnabled: true,
    facebookUrl: "https://www.facebook.com/events/123",
  };
  const live = toPublicEventContract(baseEvent, now);

  assert.deepEqual(Object.keys(live).sort(), [
    "city",
    "endsAt",
    "facebookUrl",
    "id",
    "name",
    "publicQueueEnabled",
    "publicStatus",
    "requestsEnabled",
    "slug",
    "songRequestsEnabled",
    "startsAt",
    "status",
    "venueName",
  ]);
  assert.equal(live.publicStatus, "live");
  assert.equal(live.status, "live");
  assert.equal(live.requestsEnabled, true);

  const activeBeforePlannedStart = toPublicEventContract(
    {
      ...baseEvent,
      startsAt: new Date("2026-07-10T17:00:00.000Z"),
      endsAt: new Date("2026-07-10T23:00:00.000Z"),
      status: "active",
    },
    now,
  );
  assert.equal(activeBeforePlannedStart.publicStatus, "upcoming");
  assert.equal(activeBeforePlannedStart.requestsEnabled, false);

  const upcoming = toPublicEventContract(
    {
      ...baseEvent,
      startsAt: new Date("2026-07-10T17:00:00.000Z"),
      endsAt: new Date("2026-07-10T23:00:00.000Z"),
      status: "draft",
    },
    now,
  );
  assert.equal(upcoming.publicStatus, "upcoming");
  assert.equal(upcoming.requestsEnabled, false);

  const ended = toPublicEventContract(
    {
      ...baseEvent,
      endsAt: new Date("2026-07-09T17:30:00.000Z"),
      status: "active",
      closedAt: null,
    },
    now,
  );
  assert.equal(ended.publicStatus, "ended");
  assert.equal(ended.requestsEnabled, false);

  const closed = toPublicEventContract(
    {
      ...baseEvent,
      status: "closed",
      closedAt: new Date("2026-07-09T17:30:00.000Z"),
    },
    now,
  );
  assert.equal(closed.publicStatus, "ended");
  assert.equal(closed.requestsEnabled, false);
});

test("public request eligibility follows event time and song request capability", () => {
  const now = new Date("2026-07-09T18:00:00.000Z");
  const liveEvent = {
    status: "active",
    visibility: "public",
    publishedAt: new Date("2026-07-01T12:00:00.000Z"),
    startsAt: new Date("2026-07-09T17:00:00.000Z"),
    endsAt: new Date("2026-07-09T23:00:00.000Z"),
    closedAt: null,
    songRequestsEnabled: true,
  };

  assert.equal(
    canAcceptPublicRequests({
      ...liveEvent,
    }, now),
    true,
  );
  assert.deepEqual(
    toPublicEventContract(
      {
        id: 11,
        name: "Karaoke Night",
        slug: "karaoke-night",
        venue: "Klub",
        city: "Warszawa",
        startsAt: new Date("2026-07-09T17:00:00.000Z"),
        endsAt: liveEvent.endsAt,
        closedAt: null,
        status: "active",
        visibility: "public",
        publishedAt: liveEvent.publishedAt,
        songRequestsEnabled: true,
        publicQueueEnabled: false,
        facebookUrl: null,
      },
      now,
    ).requestsEnabled,
    true,
  );
  assert.deepEqual(
    toPublicEventContract(
      {
        id: 12,
        name: "Karaoke Night",
        slug: "karaoke-night",
        venue: "Klub",
        city: "Warszawa",
        startsAt: new Date("2026-07-09T17:00:00.000Z"),
        endsAt: liveEvent.endsAt,
        closedAt: null,
        status: "active",
        visibility: "public",
        publishedAt: liveEvent.publishedAt,
        songRequestsEnabled: true,
        publicQueueEnabled: true,
        facebookUrl: null,
      },
      now,
    ).requestsEnabled,
    true,
  );
  assert.equal(
    canAcceptPublicRequests({
      ...liveEvent,
      visibility: "private",
    }),
    false,
  );
  assert.equal(
    canAcceptPublicRequests(
      {
        ...liveEvent,
      },
      now,
    ),
    true,
  );
  assert.deepEqual(
    toPublicEventContract(
      {
        id: 13,
        name: "Karaoke Night",
        slug: "karaoke-night",
        venue: "Klub",
        city: "Warszawa",
        startsAt: new Date("2026-07-10T17:00:00.000Z"),
        endsAt: new Date("2026-07-10T23:00:00.000Z"),
        closedAt: null,
        status: "active",
        visibility: "public",
        publishedAt: liveEvent.publishedAt,
        songRequestsEnabled: true,
        publicQueueEnabled: false,
        facebookUrl: null,
      },
      now,
    ),
    {
      id: 13,
      slug: "karaoke-night",
      name: "Karaoke Night",
      startsAt: "2026-07-10T17:00:00.000Z",
      endsAt: "2026-07-10T23:00:00.000Z",
      venueName: "Klub",
      city: "Warszawa",
      status: "upcoming",
      publicStatus: "upcoming",
      requestsEnabled: false,
      songRequestsEnabled: true,
      publicQueueEnabled: false,
      facebookUrl: null,
    },
  );
  assert.equal(
    canAcceptPublicRequests({
      ...liveEvent,
      status: "closed",
      closedAt: new Date("2026-07-09T17:30:00.000Z"),
    }),
    false,
  );
  assert.equal(
    canAcceptPublicRequests(
      {
        ...liveEvent,
        endsAt: new Date("2026-07-09T17:30:00.000Z"),
      },
      now,
    ),
    false,
  );
  assert.equal(
    canAcceptPublicRequests({
      ...liveEvent,
      songRequestsEnabled: false,
    }),
    false,
  );
});

test("event slug unique violation classifier only accepts events_slug_idx", () => {
  assert.equal(
    isEventSlugUniqueViolation({
      code: "23505",
      constraint_name: "events_slug_idx",
    }),
    true,
  );
  assert.equal(
    isEventSlugUniqueViolation({
      code: "23505",
      constraint: "events_slug_idx",
    }),
    true,
  );
  assert.equal(
    isEventSlugUniqueViolation({
      cause: {
        code: "23505",
        constraint_name: "events_slug_idx",
      },
    }),
    true,
  );
  assert.equal(
    isEventSlugUniqueViolation({
      cause: {
        cause: {
          code: "23505",
          constraint_name: "events_slug_idx",
        },
      },
    }),
    true,
  );
  assert.equal(
    isEventSlugUniqueViolation({
      code: "23505",
      constraint_name: "workspace_members_workspace_operator_idx",
    }),
    false,
  );

  const unknownError = new Error("database unavailable");
  const cyclicError: Record<string, unknown> = {};
  cyclicError.cause = cyclicError;

  assert.equal(isEventSlugUniqueViolation(unknownError), false);
  assert.equal(isEventSlugUniqueViolation(cyclicError), false);
});

test("public event catalog migration adds private-by-default publication fields", () => {
  const schemaSource = readFileSync("src/db/schema.ts", "utf8");
  const migrationSource = readFileSync(
    "drizzle/0010_public_event_catalog.sql",
    "utf8",
  );

  assert.match(schemaSource, /eventVisibilityValues = \["private", "public"\]/);
  assert.match(schemaSource, /slug: text\("slug"\)/);
  assert.match(schemaSource, /city: text\("city"\)/);
  assert.match(schemaSource, /publishedAt: timestampColumn\("published_at"\)/);
  assert.match(schemaSource, /events_slug_idx/);
  assert.match(schemaSource, /events_slug_format_check/);
  assert.match(schemaSource, /events_public_requires_slug_and_published_at_check/);
  assert.match(migrationSource, /CREATE TYPE "public"\."event_visibility"/);
  assert.match(migrationSource, /DEFAULT 'private' NOT NULL/);
  assert.match(migrationSource, /CREATE UNIQUE INDEX "events_slug_idx"/);
  assert.match(migrationSource, /WHERE "events"\."slug" is not null/);
});

test("event lifecycle migration adds endsAt and request capability safely", () => {
  const schemaSource = readFileSync("src/db/schema.ts", "utf8");
  const migrationSource = readFileSync(
    "drizzle/0012_low_morgan_stark.sql",
    "utf8",
  );

  assert.match(schemaSource, /endsAt: timestampColumn\("ends_at"\)\.notNull\(\)/);
  assert.match(schemaSource, /songRequestsEnabled: boolean\("song_requests_enabled"\)/);
  assert.match(schemaSource, /events_ends_after_starts_check/);
  assert.match(schemaSource, /sql`\$\{table\.endsAt\} > \$\{table\.startsAt\}`/);
  assert.match(schemaSource, /"cancelled"/);
  assert.match(migrationSource, /ADD COLUMN "ends_at" timestamp with time zone;/);
  assert.match(migrationSource, /SET "ends_at" = COALESCE\("auto_close_at"/);
  assert.match(migrationSource, /ALTER COLUMN "ends_at" SET NOT NULL/);
  assert.match(
    migrationSource,
    /SET "song_requests_enabled" = "public_queue_enabled"/,
  );
  assert.match(
    migrationSource,
    /WHERE "song_requests_enabled" = false\s+AND "public_queue_enabled" = true/,
  );
  assert.match(
    migrationSource,
    /ADD CONSTRAINT "events_ends_after_starts_check" CHECK \("events"\."ends_at" > "events"\."starts_at"\)/,
  );
});

test("public catalog API filters unpublished private and slugless events", () => {
  const serviceSource = readFileSync("src/server/public-api/service.ts", "utf8");
  const listStart = serviceSource.indexOf("export async function listPublicEvents");
  const detailStart = serviceSource.indexOf("export async function getPublicEventBySlug");
  const listSource = serviceSource.slice(listStart, detailStart);
  const detailSource = serviceSource.slice(detailStart);

  assert.match(listSource, /eq\(events\.visibility, "public"\)/);
  assert.match(listSource, /isNotNull\(events\.slug\)/);
  assert.match(listSource, /isNotNull\(events\.publishedAt\)/);
  assert.match(serviceSource, /events\.endsAt/);
  assert.equal(listSource.includes('eq(events.status, "active")'), false);
  assert.equal(listSource.includes('eq(events.status, "draft")'), false);
  assert.match(serviceSource, /case when/);
  assert.match(detailSource, /eq\(events\.visibility, "public"\)/);
  assert.match(detailSource, /eq\(events\.slug, slug\)/);
  assert.match(detailSource, /PUBLIC_EVENT_NOT_FOUND/);
});

test("public event query normalization accepts ended and safely falls back", () => {
  assert.deepEqual(
    normalizePublicEventsQuery({
      q: "  Karaoke   Klub  ",
      city: "  Gdynia ",
      date: "2026-07-10",
      phase: "ended",
      sort: "newest",
    }),
    {
      q: "Karaoke Klub",
      city: "Gdynia",
      date: "2026-07-10",
      phase: "ended",
      sort: "newest",
    },
  );
  assert.deepEqual(
    normalizePublicEventsQuery({
      date: "2026-02-31",
      phase: "cancelled",
      sort: "popular",
    }),
    {
      q: null,
      city: null,
      date: null,
      phase: "all",
      sort: "soonest",
    },
  );
});

test("public event date filter builds Warsaw calendar-day ranges including DST", () => {
  const regularDay = getPublicEventDateRange("2026-07-10");
  assert.equal(regularDay?.start.toISOString(), "2026-07-09T22:00:00.000Z");
  assert.equal(regularDay?.end.toISOString(), "2026-07-10T22:00:00.000Z");

  const dstStart = getPublicEventDateRange("2026-03-29");
  assert.equal(dstStart?.start.toISOString(), "2026-03-28T23:00:00.000Z");
  assert.equal(dstStart?.end.toISOString(), "2026-03-29T22:00:00.000Z");
  assert.equal(
    dstStart
      ? (dstStart.end.getTime() - dstStart.start.getTime()) / 3_600_000
      : null,
    23,
  );

  const dstEnd = getPublicEventDateRange("2026-10-25");
  assert.equal(dstEnd?.start.toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(dstEnd?.end.toISOString(), "2026-10-25T23:00:00.000Z");
  assert.equal(
    dstEnd ? (dstEnd.end.getTime() - dstEnd.start.getTime()) / 3_600_000 : null,
    25,
  );

  assert.equal(getPublicEventDateRange("2026-02-31"), null);
  assert.equal(getPublicEventDateRange("not-a-date"), null);
});

test("Warsaw weekend range covers Friday Saturday Sunday and UTC date drift", () => {
  const friday = getWarsawWeekendRange(new Date("2026-07-10T10:00:00.000Z"));
  assert.equal(friday.start.toISOString(), "2026-07-10T22:00:00.000Z");
  assert.equal(friday.end.toISOString(), "2026-07-12T22:00:00.000Z");

  const saturday = getWarsawWeekendRange(new Date("2026-07-11T10:00:00.000Z"));
  assert.equal(saturday.start.toISOString(), "2026-07-10T22:00:00.000Z");
  assert.equal(saturday.end.toISOString(), "2026-07-12T22:00:00.000Z");

  const sunday = getWarsawWeekendRange(new Date("2026-07-12T10:00:00.000Z"));
  assert.equal(sunday.start.toISOString(), "2026-07-10T22:00:00.000Z");
  assert.equal(sunday.end.toISOString(), "2026-07-12T22:00:00.000Z");

  const warsawSaturdayUtcFriday = getWarsawWeekendRange(
    new Date("2026-07-10T22:30:00.000Z"),
  );
  assert.equal(
    warsawSaturdayUtcFriday.start.toISOString(),
    "2026-07-10T22:00:00.000Z",
  );
  assert.equal(
    warsawSaturdayUtcFriday.end.toISOString(),
    "2026-07-12T22:00:00.000Z",
  );
});

test("Warsaw weekend membership is start-inclusive and end-exclusive", () => {
  const referenceNow = new Date("2026-07-11T12:00:00.000Z");

  assert.equal(
    isInWarsawWeekend("2026-07-10T21:59:59.999Z", referenceNow),
    false,
  );
  assert.equal(
    isInWarsawWeekend("2026-07-10T22:00:00.000Z", referenceNow),
    true,
  );
  assert.equal(
    isInWarsawWeekend("2026-07-12T21:59:59.999Z", referenceNow),
    true,
  );
  assert.equal(
    isInWarsawWeekend("2026-07-12T22:00:00.000Z", referenceNow),
    false,
  );
});

test("homepage renders neutral discovery and search links to events directory", () => {
  const homeSource = readFileSync("src/app/(public)/page.tsx", "utf8");
  const homeComponentSource = readFileSync(
    "src/components/public/discovery-home-page.tsx",
    "utf8",
  );
  const searchFormSource = readFileSync(
    "src/components/public/event-search-form.tsx",
    "utf8",
  );

  assert.match(homeSource, /DiscoveryHomePage/);
  assert.match(homeSource, /dynamic = "force-dynamic"/);
  assert.match(homeComponentSource, /Znajdź karaoke blisko siebie/);
  assert.match(homeComponentSource, /Odkrywaj wydarzenia karaoke w całej Polsce/);
  assert.match(searchFormSource, /action="\/events"/);
  assert.match(searchFormSource, /name="q"/);
  assert.match(searchFormSource, /name="city"/);
  assert.match(searchFormSource, /name="date"/);
});

test("public route group uses shared public layout and header", () => {
  const rootLayoutSource = readFileSync("src/app/layout.tsx", "utf8");
  const publicLayoutSource = readFileSync("src/app/(public)/layout.tsx", "utf8");
  const headerSource = readFileSync(
    "src/components/public/public-site-header.tsx",
    "utf8",
  );

  assert.match(rootLayoutSource, /<html lang="pl">/);
  assert.doesNotMatch(rootLayoutSource, /PublicSiteHeader/);
  assert.match(publicLayoutSource, /PublicSiteHeader/);
  assert.match(headerSource, /<header/);
  assert.match(headerSource, /<nav/);
  assert.match(headerSource, /aria-label="Nawigacja publiczna"/);
  assert.match(headerSource, /href="\/"/);
  assert.match(headerSource, /loading="eager"/);
  assert.doesNotMatch(headerSource, /priority|preload|fetchPriority/);
  assert.match(headerSource, /href="\/events"/);
  assert.match(headerSource, /Wydarzenia/);
  assert.match(headerSource, /href="\/dashboard"/);
  assert.match(headerSource, /Panel organizatora/);
  assert.equal(existsSync("src/app/(public)/session"), false);
  assert.equal(existsSync("src/app/(public)/dashboard"), false);
  assert.equal(existsSync("src/app/page.tsx"), false);
  assert.equal(existsSync("src/app/events/page.tsx"), false);
});

test("homepage carousels use real event sections and skip empty data", () => {
  const homeComponentSource = readFileSync(
    "src/components/public/discovery-home-page.tsx",
    "utf8",
  );
  const carouselSource = readFileSync(
    "src/components/public/event-carousel.tsx",
    "utf8",
  );

  assert.match(homeComponentSource, /title="Trwa teraz"/);
  assert.match(homeComponentSource, /title="Nadchodzące karaoke"/);
  assert.match(homeComponentSource, /title="Ten weekend"/);
  assert.match(homeComponentSource, /title="Nowo dodane"/);
  assert.match(homeComponentSource, /isInWarsawWeekend/);
  assert.match(homeComponentSource, /isPromotablePublicEventStatus/);
  assert.match(carouselSource, /useEmblaCarousel\(\{ loop: false \}\)/);
  assert.match(carouselSource, /events\.length === 0/);
  assert.match(carouselSource, /return null/);
  assert.match(carouselSource, /canScrollPrev/);
  assert.match(carouselSource, /canScrollNext/);
  assert.doesNotMatch(carouselSource, /Autoplay|autoplay/);
});

test("events directory renders full catalog grid and maps filters to service contract", () => {
  const pageSource = readFileSync("src/app/(public)/events/page.tsx", "utf8");
  const routeSource = readFileSync("src/app/api/public/events/route.ts", "utf8");
  const serviceSource = readFileSync("src/server/public-api/service.ts", "utf8");
  const discoveryHelperSource = readFileSync(
    "src/lib/public-event-discovery.ts",
    "utf8",
  );
  const searchFormSource = readFileSync(
    "src/components/public/event-search-form.tsx",
    "utf8",
  );

  assert.match(pageSource, /Katalog wydarzeń karaoke/);
  assert.match(pageSource, /showDirectoryFilters/);
  assert.match(pageSource, /className=\{styles\.grid\}/);
  assert.match(pageSource, /PublicEventCard/);
  assert.match(pageSource, /Brak pasujących wydarzeń/);
  assert.match(routeSource, /url\.searchParams\.get\("q"\)/);
  assert.match(routeSource, /url\.searchParams\.get\("city"\)/);
  assert.match(routeSource, /url\.searchParams\.get\("date"\)/);
  assert.match(routeSource, /url\.searchParams\.get\("phase"\)/);
  assert.match(routeSource, /url\.searchParams\.get\("sort"\)/);
  assert.match(
    discoveryHelperSource,
    /publicEventPhaseValues = \["all", "live", "upcoming", "ended"\]/,
  );
  assert.match(
    discoveryHelperSource,
    /publicEventSortValues = \["soonest", "newest"\]/,
  );
  assert.match(serviceSource, /ilike\(events\.name, pattern\)/);
  assert.match(serviceSource, /ilike\(events\.city/);
  assert.match(serviceSource, /gte\(events\.startsAt, dateRange\.start\)/);
  assert.match(serviceSource, /desc\(events\.publishedAt\)/);
  assert.match(searchFormSource, /value="ended"/);
  assert.match(searchFormSource, /Zakończone/);
});

test("event cards use the public contract and link to the event slug", () => {
  const cardSource = readFileSync(
    "src/components/public/event-card.tsx",
    "utf8",
  );

  assert.match(cardSource, /event\.name/);
  assert.match(cardSource, /event\.startsAt/);
  assert.match(cardSource, /event\.city/);
  assert.match(cardSource, /event\.venueName/);
  assert.match(cardSource, /event\.publicStatus/);
  assert.match(cardSource, /href=\{`\/events\/\$\{event\.slug\}`\}/);
  assert.doesNotMatch(cardSource, /workspaceId|operator|accessLink|songRequests/);
});

test("public event detail route stays informational without request form", () => {
  const listRouteSource = readFileSync("src/app/api/public/events/route.ts", "utf8");
  const detailRouteSource = readFileSync(
    "src/app/api/public/events/[slug]/route.ts",
    "utf8",
  );
  const pageSource = readFileSync("src/app/(public)/events/[slug]/page.tsx", "utf8");

  assert.match(listRouteSource, /listPublicEvents/);
  assert.match(detailRouteSource, /getPublicEventBySlug/);
  assert.match(pageSource, /getPublicEventBySlug/);
  assert.match(pageSource, /notFound\(\)/);
  assert.match(pageSource, /kod QR/);
  assert.doesNotMatch(pageSource, /PublicEventRequestForm/);
  assert.doesNotMatch(pageSource, /brandLogo/);
  assert.doesNotMatch(pageSource, /searchPublicSongs/);
  assert.doesNotMatch(pageSource, /createPublicRequest/);
});

test("publishing remains behind event manager RBAC and preserves publishedAt on unpublish", () => {
  const organizationsSource = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );
  const updateStart = organizationsSource.indexOf(
    "export async function updateDashboardOrganizationEventDetailsForAuthUser",
  );
  const updateEnd = organizationsSource.indexOf(
    "export async function extendDashboardOrganizationEventForAuthUser",
  );
  const updateSource = organizationsSource.slice(updateStart, updateEnd);

  assert.match(updateSource, /requireEventManagerOrganizationEventInTransaction/);
  assert.match(updateSource, /resolveDashboardEventCatalogFieldsInTransaction/);
  assert.match(updateSource, /mapEventSlugUniqueViolation/);
  assert.match(updateSource, /visibility: catalogFields\.visibility/);
  assert.match(organizationsSource, /publishedAt: event\.publishedAt \?\? now/);
  assert.match(organizationsSource, /publishedAt: event\.publishedAt/);
  assert.match(organizationsSource, /EVENT_SLUG_ALREADY_EXISTS/);
  assert.match(organizationsSource, /throw error/);
  assert.equal(updateSource.includes('eq(workspaceMembers.role, "viewer")'), false);
});
