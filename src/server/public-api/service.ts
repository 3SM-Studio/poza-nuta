import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import { events, songs } from "../../db/schema";
import { getDb } from "../db";
import { isValidEventSlug } from "../../lib/event-slug";
import {
  getPublicEventDateRange,
  matchesPublicEventPhase,
  normalizePublicEventsQuery,
  type PublicEventSort,
  type PublicEventsQuery,
} from "../../lib/public-event-discovery";
import { toPublicEventContract } from "../../lib/public-event-contract";
import { traceServerStep } from "../runtime-diagnostics";
import { PublicApiError } from "./errors";

export const PUBLIC_SONG_SEARCH_LIMIT = 20;

const publicEventSelection = {
  id: events.id,
  name: events.name,
  slug: events.slug,
  venue: events.venue,
  city: events.city,
  startsAt: events.startsAt,
  autoCloseAt: events.autoCloseAt,
  endsAt: events.endsAt,
  closedAt: events.closedAt,
  status: events.status,
  visibility: events.visibility,
  publishedAt: events.publishedAt,
  songRequestsEnabled: events.songRequestsEnabled,
  publicQueueEnabled: events.publicQueueEnabled,
  facebookUrl: events.facebookUrl,
};

export async function listPublicEvents(
  routeName?: string,
  query: PublicEventsQuery = {},
) {
  const now = new Date();
  const normalizedQuery = normalizePublicEventsQuery(query);
  const filters = [
    eq(events.visibility, "public"),
    isNotNull(events.slug),
    isNotNull(events.publishedAt),
  ];
  const dateRange = getPublicEventDateRange(normalizedQuery.date);

  if (normalizedQuery.q) {
    const pattern = `%${escapeLikePattern(normalizedQuery.q)}%`;
    const searchFilter = or(
      ilike(events.name, pattern),
      ilike(events.venue, pattern),
      ilike(events.city, pattern),
    );

    if (searchFilter) {
      filters.push(searchFilter);
    }
  }

  if (normalizedQuery.city) {
    filters.push(ilike(events.city, `%${escapeLikePattern(normalizedQuery.city)}%`));
  }

  if (dateRange) {
    filters.push(gte(events.startsAt, dateRange.start));
    filters.push(lt(events.startsAt, dateRange.end));
  }

  const publicEvents = await runPublicApiStep(routeName, "publicEvents", () =>
    getDb()
      .select(publicEventSelection)
      .from(events)
      .where(and(...filters))
      .orderBy(...getPublicEventOrderBy(normalizedQuery.sort, now)),
  );

  return publicEvents
    .map((event) => toPublicEventContract(event, now))
    .filter((event) => matchesPublicEventPhase(event.publicStatus, normalizedQuery.phase));
}

export async function getPublicEventBySlug(slug: string, routeName?: string) {
  if (!isValidEventSlug(slug)) {
    throw new PublicApiError(
      404,
      "PUBLIC_EVENT_NOT_FOUND",
      "Public event was not found.",
    );
  }

  const [event] = await runPublicApiStep(routeName, "publicEvent", () =>
    getDb()
      .select(publicEventSelection)
      .from(events)
      .where(
        and(
          eq(events.visibility, "public"),
          eq(events.slug, slug),
          isNotNull(events.publishedAt),
        ),
      )
      .limit(1),
  );

  if (!event) {
    throw new PublicApiError(
      404,
      "PUBLIC_EVENT_NOT_FOUND",
      "Public event was not found.",
    );
  }

  return toPublicEventContract(event);
}

export async function searchPublicSongs(query: string | null) {
  if (query === null) {
    return [];
  }

  const pattern = `%${escapeLikePattern(query)}%`;

  return getDb()
    .select({
      id: songs.id,
      source: songs.source,
      title: songs.title,
      artist: songs.artist,
      durationSeconds: songs.durationSeconds,
      isDuet: songs.isDuet,
      isExplicit: songs.isExplicit,
      isPlus: songs.isPlus,
      isHit: songs.isHit,
    })
    .from(songs)
    .where(ilike(songs.searchText, pattern))
    .orderBy(songs.normalizedArtist, songs.normalizedTitle, songs.id)
    .limit(PUBLIC_SONG_SEARCH_LIMIT);
}

function escapeLikePattern(input: string) {
  return input.replace(/[\\%_]/g, "\\$&");
}

function getPublicEventOrderBy(sort: PublicEventSort, now: Date) {
  if (sort === "newest") {
    return [desc(events.publishedAt), desc(events.id)];
  }

  const referenceNow = now.toISOString();

  return [
    sql`case when ${events.startsAt} <= ${referenceNow}::timestamptz and ${events.endsAt} > ${referenceNow}::timestamptz then 0 when ${events.startsAt} > ${referenceNow}::timestamptz then 1 else 2 end`,
    asc(events.startsAt),
    asc(events.slug),
  ];
}

function runPublicApiStep<T>(
  routeName: string | undefined,
  stepName: string,
  action: () => Promise<T>,
) {
  return routeName ? traceServerStep(routeName, stepName, action) : action();
}
