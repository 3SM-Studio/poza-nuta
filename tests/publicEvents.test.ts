import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildEventSlugCollisionCandidate,
  formatEventSlug,
  isValidEventSlug,
} from "../src/lib/event-slug.ts";
import { isEventSlugUniqueViolation } from "../src/lib/event-slug-db-error.ts";
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
  assert.match(listSource, /events\.endsAt/);
  assert.equal(listSource.includes('eq(events.status, "active")'), false);
  assert.equal(listSource.includes('eq(events.status, "draft")'), false);
  assert.match(listSource, /case when/);
  assert.match(detailSource, /eq\(events\.visibility, "public"\)/);
  assert.match(detailSource, /eq\(events\.slug, slug\)/);
  assert.match(detailSource, /PUBLIC_EVENT_NOT_FOUND/);
});

test("public event detail route stays informational without request form", () => {
  const listRouteSource = readFileSync("src/app/api/public/events/route.ts", "utf8");
  const detailRouteSource = readFileSync(
    "src/app/api/public/events/[slug]/route.ts",
    "utf8",
  );
  const pageSource = readFileSync("src/app/events/[slug]/page.tsx", "utf8");

  assert.match(listRouteSource, /listPublicEvents/);
  assert.match(detailRouteSource, /getPublicEventBySlug/);
  assert.match(pageSource, /getPublicEventBySlug/);
  assert.match(pageSource, /notFound\(\)/);
  assert.match(pageSource, /kod QR/);
  assert.doesNotMatch(pageSource, /PublicEventRequestForm/);
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
