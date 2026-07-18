import "server-only";

import { and, eq, ilike, inArray, max, sql } from "drizzle-orm";

import { events, songRequests, songs } from "../../db/schema";
import {
  canUseSessionPublicQueue,
  canUseSessionSongRequests,
} from "../../lib/session-capabilities";
import {
  getSessionEventAccessStatus,
  isValidSessionCodeFormat,
  type SessionEventAccessStatus,
} from "../../lib/session-event-access";
import { getDb } from "../db";
import { PublicApiError } from "../public-api/errors";
import { PUBLIC_QUEUE_VISIBLE_STATUSES } from "../public-api/queue-policy";
import { PUBLIC_SONG_SEARCH_LIMIT } from "../public-api/service";
import type { SessionRequestInput } from "./validation";

type DatabaseTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

const sessionEventSelection = {
  id: events.id,
  name: events.name,
  venue: events.venue,
  startsAt: events.startsAt,
  status: events.status,
  publicQueueEnabled: events.publicQueueEnabled,
  songRequestsEnabled: events.songRequestsEnabled,
  publicShowSongTitles: events.publicShowSongTitles,
  autoCloseAt: events.autoCloseAt,
  endsAt: events.endsAt,
  closedAt: events.closedAt,
};

const ACTIVE_SESSION_REQUEST_STATUSES = [
  "pending",
  "approved",
  "now",
] as const;

type SessionEventRow = {
  event: PublicSessionEvent;
};

export type SessionEventAccess =
  | { status: "invalid" }
  | {
      status: Exclude<SessionEventAccessStatus, "invalid">;
      event: PublicSessionEvent;
    };

export type PublicSessionEvent = {
  id: number;
  name: string;
  venue: string | null;
  startsAt: Date;
  status: "draft" | "active" | "closed" | "cancelled";
  publicQueueEnabled: boolean;
  songRequestsEnabled: boolean;
  publicShowSongTitles: boolean;
  autoCloseAt: Date | null;
  endsAt: Date;
  closedAt: Date | null;
};

export async function resolveSessionEventAccess(
  code: string,
  now = new Date(),
): Promise<SessionEventAccess> {
  const row = await findSessionEventByCode(code);
  const status = getSessionEventAccessStatus({
    event: row?.event ?? null,
    now,
  });

  if (!row || status === "invalid") {
    return { status: "invalid" };
  }

  return {
    status,
    event: toPublicSessionEvent(row.event),
  };
}

export async function getSessionEvent(code: string) {
  const session = await requireLiveSession(code);

  return {
    event: toPublicSessionEvent(session.event),
  };
}

export async function searchSessionSongs(
  code: string,
  query: string | null,
) {
  await requireSongRequestSession(code);

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

export async function getSessionQueue(code: string) {
  const session = await requireLiveSession(code);

  if (!canUseSessionPublicQueue(session.event)) {
    return {
      eventId: session.event.id,
      enabled: false as const,
      showSongTitles: session.event.publicShowSongTitles,
      items: [],
    };
  }

  if (session.event.publicShowSongTitles) {
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
          eq(songRequests.eventId, session.event.id),
          inArray(songRequests.status, PUBLIC_QUEUE_VISIBLE_STATUSES),
        ),
      )
      .orderBy(songRequests.position, songRequests.id);

    return {
      eventId: session.event.id,
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
        eq(songRequests.eventId, session.event.id),
        inArray(songRequests.status, PUBLIC_QUEUE_VISIBLE_STATUSES),
      ),
    )
    .orderBy(songRequests.position, songRequests.id);

  return {
    eventId: session.event.id,
    enabled: true as const,
    showSongTitles: false as const,
    items,
  };
}

export async function createSessionRequest(
  code: string,
  input: SessionRequestInput,
) {
  return getDb().transaction(async (transaction) => {
    const session = await requireSongRequestSessionInTransaction(
      transaction,
      code,
    );

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

    const [duplicateRequest] = await transaction
      .select({ id: songRequests.id })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.eventId, session.event.id),
          eq(songRequests.songId, song.id),
          sql`lower(${songRequests.displayName}) = lower(${input.singerName})`,
          inArray(songRequests.status, ACTIVE_SESSION_REQUEST_STATUSES),
        ),
      )
      .limit(1);

    if (duplicateRequest) {
      throw new PublicApiError(
        409,
        "SESSION_REQUEST_DUPLICATE",
        "This singer already has an active request for the selected song.",
      );
    }

    const [queueState] = await transaction
      .select({ maxPosition: max(songRequests.position) })
      .from(songRequests)
      .where(eq(songRequests.eventId, session.event.id));
    const position = (queueState?.maxPosition ?? 0) + 1;
    const now = new Date();

    const [request] = await transaction
      .insert(songRequests)
      .values({
        eventId: session.event.id,
        songId: song.id,
        singerName: input.singerName,
        displayName: input.singerName,
        note: input.note,
        status: "pending",
        position,
        requestedBy: "public",
        updatedAt: now,
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

async function requireLiveSession(code: string) {
  const row = await findSessionEventByCode(code);
  return requireLiveSessionRow(row);
}

async function requireSongRequestSession(code: string) {
  const session = await requireLiveSession(code);
  return requireSongRequestsEnabled(session);
}

async function requireSongRequestSessionInTransaction(
  transaction: DatabaseTransaction,
  code: string,
) {
  const row = await findSessionEventByCodeInTransaction(transaction, code);
  return requireSongRequestsEnabled(requireLiveSessionRow(row));
}

function requireLiveSessionRow(row: SessionEventRow | null) {
  const status = getSessionEventAccessStatus({
    event: row?.event ?? null,
  });

  if (!row || status === "invalid") {
    throw new PublicApiError(
      404,
      "SESSION_LINK_INVALID",
      "The session link is invalid or expired.",
    );
  }

  if (status === "scheduled") {
    throw new PublicApiError(
      403,
      "SESSION_EVENT_NOT_STARTED",
      "The event has not started yet.",
    );
  }

  if (status === "closed") {
    throw new PublicApiError(
      403,
      "SESSION_EVENT_CLOSED",
      "Song requests are already closed.",
    );
  }

  return row;
}

function requireSongRequestsEnabled(row: SessionEventRow) {
  if (!canUseSessionSongRequests(row.event)) {
    throw new PublicApiError(
      403,
      "SESSION_PUBLIC_REQUESTS_DISABLED",
      "Public song requests are disabled for this event.",
    );
  }

  return row;
}

async function findSessionEventByCode(code: string) {
  if (!isValidSessionCodeFormat(code)) {
    return null;
  }

  const [row] = await getDb()
    .select({
      event: sessionEventSelection,
    })
    .from(events)
    .where(eq(events.sessionCode, code))
    .limit(1);

  return row ?? null;
}

async function findSessionEventByCodeInTransaction(
  transaction: DatabaseTransaction,
  code: string,
) {
  if (!isValidSessionCodeFormat(code)) {
    return null;
  }

  const [row] = await transaction
    .select({
      event: sessionEventSelection,
    })
    .from(events)
    .where(eq(events.sessionCode, code))
    .for("update")
    .limit(1);

  return row ?? null;
}

function toPublicSessionEvent(event: PublicSessionEvent): PublicSessionEvent {
  return {
    id: event.id,
    name: event.name,
    venue: event.venue,
    startsAt: event.startsAt,
    status: event.status,
    publicQueueEnabled: event.publicQueueEnabled,
    songRequestsEnabled: event.songRequestsEnabled,
    publicShowSongTitles: event.publicShowSongTitles,
    autoCloseAt: event.autoCloseAt,
    endsAt: event.endsAt,
    closedAt: event.closedAt,
  };
}

function escapeLikePattern(input: string) {
  return input.replace(/[\\%_]/g, "\\$&");
}
