import "server-only";

import { and, eq, ilike, inArray, max } from "drizzle-orm";

import { events, songRequests, songs } from "../../db/schema";
import { getDb } from "../db";
import {
  closeExpiredActiveEventInTransaction,
  getActiveEventAfterLazyClose,
} from "../event-lifecycle";
import { PublicApiError } from "./errors";
import { PUBLIC_QUEUE_VISIBLE_STATUSES } from "./queue-policy";
import type { PublicRequestInput } from "./validation";

export const PUBLIC_SONG_SEARCH_LIMIT = 20;

const activePublicEventFilter = and(
  eq(events.isActivePublicEvent, true),
  eq(events.status, "active"),
);

export async function getActivePublicEvent() {
  const event = await getActiveEventAfterLazyClose();

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

export async function searchPublicSongs(query: string | null) {
  await getActivePublicEvent();

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

export async function createPublicRequest(input: PublicRequestInput) {
  return getDb().transaction(async (transaction) => {
    await closeExpiredActiveEventInTransaction(transaction);

    const [event] = await transaction
      .select({
        id: events.id,
      })
      .from(events)
      .where(activePublicEventFilter)
      .for("update")
      .limit(1);

    if (!event) {
      throw new PublicApiError(
        404,
        "ACTIVE_EVENT_NOT_FOUND",
        "No active public event is available.",
      );
    }

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

export async function getPublicQueue() {
  const event = await getActivePublicEvent();

  if (!event.publicQueueEnabled) {
    return {
      eventId: event.id,
      enabled: false as const,
      showSongTitles: event.publicShowSongTitles,
      items: [],
    };
  }

  if (event.publicShowSongTitles) {
    const items = await getDb()
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
      .orderBy(songRequests.position, songRequests.id);

    return {
      eventId: event.id,
      enabled: true as const,
      showSongTitles: true as const,
      items,
    };
  }

  const items = await getDb()
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
    .orderBy(songRequests.position, songRequests.id);

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
