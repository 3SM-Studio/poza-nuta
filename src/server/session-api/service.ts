import "server-only";

import { and, eq, gt, ilike, inArray, isNull, lte, max, or, sql } from "drizzle-orm";

import {
  eventSessionCodes,
  eventSessions,
  events,
  songRequests,
  songs,
} from "../../db/schema";
import { canResolveEventJoinCode } from "../../lib/event-session-lifecycle";
import { isEventSessionPublicToken } from "../../lib/event-session-identity";
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
  closeReason: events.closeReason,
};

const ACTIVE_SESSION_REQUEST_STATUSES = [
  "pending",
  "approved",
  "now",
] as const;

type SessionEventRecord = {
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
  closeReason: string | null;
};

type SessionEventRow = {
  event: SessionEventRecord;
  publicToken: string;
};

type SessionLookup =
  | { kind: "code"; value: string }
  | { kind: "token"; value: string };

export type SessionEventAccess =
  | { status: "invalid" }
  | {
      status: Exclude<SessionEventAccessStatus, "invalid">;
      event: PublicSessionEvent;
    };

export type PublicSessionEvent = {
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
  closeReason: string | null;
};

export async function resolveSessionEventAccess(
  code: string,
  now = new Date(),
): Promise<SessionEventAccess> {
  const row = await findSessionEvent({ kind: "code", value: code }, now);
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

export async function resolvePublicSessionEventAccess(
  publicToken: string,
  now = new Date(),
): Promise<SessionEventAccess> {
  const row = await findSessionEvent({ kind: "token", value: publicToken }, now);
  const status = getSessionEventAccessStatus({
    event: row?.event ?? null,
    now,
  });

  if (!row || status === "invalid") return { status: "invalid" };
  return { status, event: toPublicSessionEvent(row.event) };
}

export async function resolveJoinCode(code: string, now = new Date()) {
  const row = await findSessionEvent({ kind: "code", value: code }, now);

  if (!row || !canResolveEventJoinCode(row.event, now)) {
    return { status: "invalid" as const };
  }

  return {
    status: "resolved" as const,
    publicToken: row.publicToken,
  };
}

export async function getSessionEvent(code: string) {
  const session = await requireLiveSession({ kind: "code", value: code });

  return {
    event: toPublicSessionEvent(session.event),
  };
}

export async function getPublicSessionEvent(publicToken: string) {
  const access = await resolvePublicSessionEventAccess(publicToken);

  if (access.status === "invalid") {
    throw new PublicApiError(
      404,
      "SESSION_LINK_INVALID",
      "The session link is invalid or expired.",
    );
  }

  return {
    accessStatus: access.status,
    event: access.event,
  };
}

export async function searchSessionSongs(
  code: string,
  query: string | null,
) {
  await requireSongRequestSession({ kind: "code", value: code });

  return searchSongs(query);
}

export async function searchPublicSessionSongs(
  publicToken: string,
  query: string | null,
) {
  await requireSongRequestSession({ kind: "token", value: publicToken });

  return searchSongs(query);
}

function searchSongs(query: string | null) {

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
  return getQueueForLookup({ kind: "code", value: code });
}

export async function getPublicSessionQueue(publicToken: string) {
  return getQueueForLookup({ kind: "token", value: publicToken });
}

async function getQueueForLookup(lookup: SessionLookup) {
  const session = await requireLiveSession(lookup);

  if (!canUseSessionPublicQueue(session.event)) {
    return {
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
    enabled: true as const,
    showSongTitles: false as const,
    items,
  };
}

export async function createSessionRequest(
  code: string,
  input: SessionRequestInput,
) {
  return createRequestForLookup({ kind: "code", value: code }, input);
}

export async function createPublicSessionRequest(
  publicToken: string,
  input: SessionRequestInput,
) {
  return createRequestForLookup({ kind: "token", value: publicToken }, input);
}

async function createRequestForLookup(
  lookup: SessionLookup,
  input: SessionRequestInput,
) {
  return getDb().transaction(async (transaction) => {
    const session = await requireSongRequestSessionInTransaction(
      transaction,
      lookup,
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
        status: songRequests.status,
      });

    if (!request) {
      throw new Error("Session request could not be created.");
    }

    return request;
  });
}

async function requireLiveSession(lookup: SessionLookup) {
  const row = await findSessionEvent(lookup);
  return requireLiveSessionRow(row);
}

async function requireSongRequestSession(lookup: SessionLookup) {
  const session = await requireLiveSession(lookup);
  return requireSongRequestsEnabled(session);
}

async function requireSongRequestSessionInTransaction(
  transaction: DatabaseTransaction,
  lookup: SessionLookup,
) {
  const row = await findSessionEventInTransaction(transaction, lookup);
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

async function findSessionEvent(lookup: SessionLookup, now = new Date()) {
  if (!isValidLookup(lookup)) return null;

  const query = getDb()
    .select({
      event: sessionEventSelection,
      publicToken: eventSessions.publicToken,
    })
    .from(eventSessions)
    .innerJoin(events, eq(events.id, eventSessions.eventId));

  const [row] =
    lookup.kind === "token"
      ? await query.where(eq(eventSessions.publicToken, lookup.value)).limit(1)
      : await query
          .innerJoin(
            eventSessionCodes,
            eq(eventSessionCodes.sessionId, eventSessions.id),
          )
          .where(
            and(
              eq(eventSessionCodes.code, lookup.value),
              lte(eventSessionCodes.validFrom, now),
              isNull(eventSessionCodes.revokedAt),
              or(
                isNull(eventSessionCodes.validUntil),
                gt(eventSessionCodes.validUntil, now),
              ),
            ),
          )
          .limit(1);

  return row ?? null;
}

async function findSessionEventInTransaction(
  transaction: DatabaseTransaction,
  lookup: SessionLookup,
) {
  if (!isValidLookup(lookup)) return null;

  const query = transaction
    .select({
      event: sessionEventSelection,
      publicToken: eventSessions.publicToken,
    })
    .from(eventSessions)
    .innerJoin(events, eq(events.id, eventSessions.eventId));

  const [row] =
    lookup.kind === "token"
      ? await query
          .where(eq(eventSessions.publicToken, lookup.value))
          .for("update")
          .limit(1)
      : await query
          .innerJoin(
            eventSessionCodes,
            eq(eventSessionCodes.sessionId, eventSessions.id),
          )
          .where(
            and(
              eq(eventSessionCodes.code, lookup.value),
              lte(eventSessionCodes.validFrom, new Date()),
              isNull(eventSessionCodes.revokedAt),
              or(
                isNull(eventSessionCodes.validUntil),
                gt(eventSessionCodes.validUntil, new Date()),
              ),
            ),
          )
          .for("update")
          .limit(1);

  return row ?? null;
}

function isValidLookup(lookup: SessionLookup) {
  return lookup.kind === "token"
    ? isEventSessionPublicToken(lookup.value)
    : isValidSessionCodeFormat(lookup.value);
}

function toPublicSessionEvent(event: SessionEventRecord): PublicSessionEvent {
  return {
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
    closeReason: event.closeReason,
  };
}

function escapeLikePattern(input: string) {
  return input.replace(/[\\%_]/g, "\\$&");
}
