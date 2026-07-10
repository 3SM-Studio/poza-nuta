import "server-only";

import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNotNull,
  max,
  sql,
} from "drizzle-orm";

import { events, songRequests, songs } from "../../db/schema";
import { getDb } from "../db";
import { isValidEventSlug } from "../../lib/event-slug";
import { getEventPhase } from "../../lib/event-phase";
import { toPublicEventContract } from "../../lib/public-event-contract";
import { canAcceptPublicRequests } from "../../lib/public-request-eligibility";
import { getActivePublicEventReadOnly } from "../event-lifecycle";
import { traceServerStep } from "../runtime-diagnostics";
import { PublicApiError } from "./errors";
import { PUBLIC_QUEUE_VISIBLE_STATUSES } from "./queue-policy";
import type { PublicRequestInput } from "./validation";

export const PUBLIC_SONG_SEARCH_LIMIT = 20;

const publicEventSelection = {
  id: events.id,
  name: events.name,
  slug: events.slug,
  venue: events.venue,
  city: events.city,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  closedAt: events.closedAt,
  status: events.status,
  visibility: events.visibility,
  publishedAt: events.publishedAt,
  songRequestsEnabled: events.songRequestsEnabled,
  publicQueueEnabled: events.publicQueueEnabled,
  facebookUrl: events.facebookUrl,
};

export async function getActivePublicEvent(routeName?: string) {
  const event = await runPublicApiStep(routeName, "activeEvent", () =>
    getActivePublicEventReadOnly(),
  );

  if (!event) {
    throw new PublicApiError(
      404,
      "ACTIVE_EVENT_NOT_FOUND",
      "No active public event is available.",
    );
  }

  return {
    id: event.id,
    name: event.name,
    venue: event.venue,
    startsAt: event.startsAt,
    status: event.status,
    publicQueueEnabled: event.publicQueueEnabled,
    publicShowSongTitles: event.publicShowSongTitles,
  };
}

export async function listPublicEvents(routeName?: string) {
  const now = new Date();
  const publicEvents = await runPublicApiStep(routeName, "publicEvents", () =>
    getDb()
      .select(publicEventSelection)
      .from(events)
      .where(
        and(
          eq(events.visibility, "public"),
          isNotNull(events.slug),
          isNotNull(events.publishedAt),
        ),
      )
      .orderBy(
        sql`case when ${events.startsAt} <= ${now} and ${events.endsAt} > ${now} then 0 when ${events.startsAt} > ${now} then 1 else 2 end`,
        asc(events.startsAt),
        asc(events.slug),
      ),
  );

  return publicEvents.map((event) => toPublicEventContract(event, now));
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

export async function createPublicRequestForEventSlug(
  slug: string,
  input: PublicRequestInput,
  referenceNow = new Date(),
) {
  if (!isValidEventSlug(slug)) {
    throw new PublicApiError(
      404,
      "PUBLIC_EVENT_NOT_FOUND",
      "Public event was not found.",
    );
  }

  return getDb().transaction(async (transaction) => {
    const [event] = await transaction
      .select({
        id: events.id,
        slug: events.slug,
        status: events.status,
        visibility: events.visibility,
        publishedAt: events.publishedAt,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        closedAt: events.closedAt,
        songRequestsEnabled: events.songRequestsEnabled,
      })
      .from(events)
      .where(eq(events.slug, slug))
      .for("update")
      .limit(1);

    if (!event || event.visibility !== "public" || !event.publishedAt) {
      throw new PublicApiError(
        404,
        "PUBLIC_EVENT_NOT_FOUND",
        "Public event was not found.",
      );
    }

    assertPublicEventAcceptsRequests(event, referenceNow);

    const [song] = await transaction
      .select({ id: songs.id })
      .from(songs)
      .where(eq(songs.id, input.songId))
      .limit(1);

    if (!song) {
      throw new PublicApiError(
        404,
        "SONG_NOT_FOUND",
        "The selected song does not exist.",
      );
    }

    const [queueState] = await transaction
      .select({ maxPosition: max(songRequests.position) })
      .from(songRequests)
      .where(eq(songRequests.eventId, event.id));
    const position = (queueState?.maxPosition ?? 0) + 1;

    const [request] = await transaction
      .insert(songRequests)
      .values({
        eventId: event.id,
        songId: song.id,
        singerName: input.singerName,
        displayName: input.singerName,
        note: input.note,
        status: "pending",
        position,
        requestedBy: "public",
      })
      .returning({
        id: songRequests.id,
        eventId: songRequests.eventId,
        songId: songRequests.songId,
        status: songRequests.status,
        position: songRequests.position,
        createdAt: songRequests.createdAt,
      });

    return request;
  });
}

export const createPublicRequest = createPublicRequestForEventSlug;

function assertPublicEventAcceptsRequests(
  event: {
    status: string;
    visibility: string;
    publishedAt: Date | null;
    startsAt: Date;
    endsAt: Date;
    closedAt: Date | null;
    songRequestsEnabled: boolean;
  },
  referenceNow: Date,
) {
  if (!event.songRequestsEnabled) {
    throw new PublicApiError(
      403,
      "PUBLIC_REQUESTS_DISABLED",
      "Song requests are disabled for this event.",
    );
  }

  const phase = getEventPhase(event, referenceNow);

  if (phase === "cancelled") {
    throw new PublicApiError(
      403,
      "PUBLIC_EVENT_CANCELLED",
      "Song requests are closed for this event.",
    );
  }

  if (!canAcceptPublicRequests(event, referenceNow)) {
    throw new PublicApiError(
      403,
      "PUBLIC_EVENT_NOT_LIVE",
      "Song requests are available only while the event is live.",
    );
  }
}

export async function getPublicQueue() {
  const event = await getActivePublicEvent("public.queue");

  if (!event.publicQueueEnabled) {
    return {
      eventId: event.id,
      enabled: false as const,
      showSongTitles: event.publicShowSongTitles,
      items: [],
    };
  }

  if (event.publicShowSongTitles) {
    const items = await traceServerStep("public.queue", "queueItems", () =>
      getDb()
        .select({
          id: songRequests.id,
          singerName: songRequests.displayName,
          status: songRequests.status,
          position: songRequests.position,
          title: songs.title,
          artist: songs.artist,
          createdAt: songRequests.createdAt,
        })
        .from(songRequests)
        .innerJoin(songs, eq(songRequests.songId, songs.id))
        .where(
          and(
            eq(songRequests.eventId, event.id),
            inArray(songRequests.status, PUBLIC_QUEUE_VISIBLE_STATUSES),
          ),
        )
        .orderBy(songRequests.position, songRequests.id),
    );

    return {
      eventId: event.id,
      enabled: true as const,
      showSongTitles: true as const,
      items,
    };
  }

  const items = await traceServerStep("public.queue", "queueItems", () =>
    getDb()
      .select({
        id: songRequests.id,
        singerName: songRequests.displayName,
        status: songRequests.status,
        position: songRequests.position,
        createdAt: songRequests.createdAt,
      })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.eventId, event.id),
          inArray(songRequests.status, PUBLIC_QUEUE_VISIBLE_STATUSES),
        ),
      )
      .orderBy(songRequests.position, songRequests.id),
  );

  return {
    eventId: event.id,
    enabled: true as const,
    showSongTitles: false as const,
    items,
  };
}

function escapeLikePattern(input: string) {
  return input.replace(/[\\%_]/g, "\\$&");
}

function runPublicApiStep<T>(
  routeName: string | undefined,
  stepName: string,
  action: () => Promise<T>,
) {
  return routeName ? traceServerStep(routeName, stepName, action) : action();
}
