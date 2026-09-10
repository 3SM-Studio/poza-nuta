import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  max,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  eventSessionCodes,
  eventSessions,
  events,
  eventParticipants,
  participantCredentials,
  participantIdentities,
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
import {
  ACTIVE_PUBLIC_REQUEST_STATUSES,
  PUBLIC_QUEUE_VISIBLE_STATUSES,
} from "../public-api/queue-policy";
import { PUBLIC_SONG_SEARCH_LIMIT } from "../public-api/service";
import {
  generateParticipantCredential,
  hashParticipantCredential,
  PARTICIPANT_CREDENTIAL_TTL_MS,
} from "./participant-credential";
import type {
  ParticipantJoinInput,
  ParticipantRenameInput,
  ParticipantSessionRequestInput,
  PublicSongBrowseQuery,
  SongBrowseCursor,
  SongBrowseSort,
} from "./validation";
import { encodeSongBrowseCursor, getSongBrowseFilterKey } from "./validation";

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
  sessionId: number;
  event: SessionEventRecord;
  publicToken: string;
};

export type PublicSessionParticipant = {
  displayName: string;
};

export type ParticipantJoinResult = {
  participant: PublicSessionParticipant;
  credential: string;
  credentialExpiresAt: Date;
};

export type PublicParticipantRequest = {
  id: string;
  title: string;
  artist: string;
  status: (typeof songRequests.status.enumValues)[number];
  queuePosition: number | null;
  isNext: boolean;
  createdAt: Date;
};

export type PublicSongBrowseItem = {
  id: number;
  source: (typeof songs.source.enumValues)[number];
  title: string;
  artist: string;
  durationSeconds: number | null;
  genres: string[];
  languages: string[];
  isDuet: boolean;
  isExplicit: boolean;
  isPlus: boolean;
  isHit: boolean;
};

export type PublicSongDiscoveryCategory = {
  value: string;
  label: string;
  count: number;
};

export type PublicSongDiscovery = {
  genres: PublicSongDiscoveryCategory[];
  languages: PublicSongDiscoveryCategory[];
  features: {
    duetCount: number;
    hitCount: number;
    plusCount: number;
  };
};

const PUBLIC_SONG_DISCOVERY_CATEGORY_LIMIT = 30;
const PUBLIC_SONG_DISCOVERY_MIN_CATEGORY_COUNT = 20;

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

type PublicSessionPageParticipantMode = "interactive" | "song_requests";

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

export async function getPublicSessionPageData(
  publicToken: string,
  credential: string | null | undefined,
  participantMode: PublicSessionPageParticipantMode,
) {
  const row = await findSessionEvent({ kind: "token", value: publicToken });
  const status = getSessionEventAccessStatus({ event: row?.event ?? null });

  if (!row || status === "invalid") {
    return {
      access: { status: "invalid" } as const,
      participant: null,
      discovery: null,
    };
  }

  const access = {
    status,
    event: toPublicSessionEvent(row.event),
  } as const;
  const participantAllowed =
    status === "active" &&
    (participantMode === "song_requests"
      ? canUseSessionSongRequests(row.event)
      : canUseSessionSongRequests(row.event) ||
        canUseSessionPublicQueue(row.event));

  if (!participantAllowed) {
    return { access, participant: null, discovery: null };
  }

  const participant = await getPublicSessionParticipantForSession(
    row,
    credential,
  );
  const discovery =
    participant && canUseSessionSongRequests(row.event)
      ? await getSongDiscovery()
      : null;

  return { access, participant, discovery };
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

export async function getPublicSessionSongDiscovery(
  publicToken: string,
): Promise<PublicSongDiscovery> {
  await requireSongRequestSession({ kind: "token", value: publicToken });

  return getSongDiscovery();
}

async function getSongDiscovery(): Promise<PublicSongDiscovery> {
  const genres = await listSongDiscoveryCategories(songs.genres);
  const languages = await listSongDiscoveryCategories(songs.languages);
  const featureRows = await getDb()
    .select({
      duetCount: sql<number>`count(*) filter (where ${songs.isDuet})::integer`,
      hitCount: sql<number>`count(*) filter (where ${songs.isHit})::integer`,
      plusCount: sql<number>`count(*) filter (where ${songs.isPlus})::integer`,
    })
    .from(songs);
  const featureCounts = featureRows[0] ?? {
    duetCount: 0,
    hitCount: 0,
    plusCount: 0,
  };

  return {
    genres,
    languages,
    features: featureCounts,
  };
}

export async function browsePublicSessionSongs(
  publicToken: string,
  query: PublicSongBrowseQuery,
) {
  await requireSongRequestSession({ kind: "token", value: publicToken });

  const conditions: SQL[] = [];
  if (query.q) {
    conditions.push(ilike(songs.searchText, `%${escapeLikePattern(query.q)}%`));
  }
  if (query.genre) {
    conditions.push(matchesNormalizedSongCategory(songs.genres, query.genre));
  }
  if (query.language) {
    conditions.push(
      matchesNormalizedSongCategory(songs.languages, query.language),
    );
  }
  if (query.duet) conditions.push(eq(songs.isDuet, true));
  if (query.hit) conditions.push(eq(songs.isHit, true));
  if (query.cursor) conditions.push(getSongBrowseCursorCondition(query.cursor));

  const rows = await getDb()
    .select({
      id: songs.id,
      source: songs.source,
      title: songs.title,
      artist: songs.artist,
      durationSeconds: songs.durationSeconds,
      genres: songs.genres,
      languages: songs.languages,
      isDuet: songs.isDuet,
      isExplicit: songs.isExplicit,
      isPlus: songs.isPlus,
      isHit: songs.isHit,
      normalizedTitle: songs.normalizedTitle,
      normalizedArtist: songs.normalizedArtist,
      createdAt: songs.createdAt,
    })
    .from(songs)
    .where(and(...conditions))
    .orderBy(...getSongBrowseOrderBy(query.sort))
    .limit(query.limit + 1);

  const pageRows = rows.slice(0, query.limit);
  const lastRow = pageRows.at(-1);
  const hasMore = rows.length > query.limit;

  return {
    items: pageRows.map(toPublicSongBrowseItem),
    nextCursor:
      hasMore && lastRow
        ? encodeSongBrowseCursor(
            toSongBrowseCursor(lastRow, query.sort, getSongBrowseFilterKey(query)),
          )
        : null,
  };
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

async function listSongDiscoveryCategories(
  column: typeof songs.genres | typeof songs.languages,
): Promise<PublicSongDiscoveryCategory[]> {
  const rows = await getDb().execute<PublicSongDiscoveryCategory>(sql`
    select
      lower(trim(category.value)) as value,
      min(category.value) as label,
      count(*)::integer as count
    from ${songs}
    cross join lateral unnest(${column}) as category(value)
    where trim(category.value) <> ''
    group by lower(trim(category.value))
    having count(*) >= ${PUBLIC_SONG_DISCOVERY_MIN_CATEGORY_COUNT}
    order by count(*) desc, value asc
    limit ${PUBLIC_SONG_DISCOVERY_CATEGORY_LIMIT}
  `);

  return Array.from(rows);
}

function matchesNormalizedSongCategory(
  column: typeof songs.genres | typeof songs.languages,
  value: string,
) {
  return sql`exists (
    select 1
    from unnest(${column}) as category(value)
    where lower(trim(category.value)) = ${value}
  )`;
}

function getSongBrowseOrderBy(sort: SongBrowseSort) {
  if (sort === "artist") {
    return [asc(songs.normalizedArtist), asc(songs.normalizedTitle), asc(songs.id)];
  }

  if (sort === "newest") {
    return [desc(songs.createdAt), desc(songs.id)];
  }

  return [asc(songs.normalizedTitle), asc(songs.normalizedArtist), asc(songs.id)];
}

function getSongBrowseCursorCondition(cursor: SongBrowseCursor): SQL {
  if (cursor.sort === "newest") {
    const createdAt = new Date(cursor.createdAt);
    return or(
      lt(songs.createdAt, createdAt),
      and(eq(songs.createdAt, createdAt), lt(songs.id, cursor.id)),
    )!;
  }

  if (cursor.sort === "artist") {
    return or(
      gt(songs.normalizedArtist, cursor.normalizedArtist),
      and(
        eq(songs.normalizedArtist, cursor.normalizedArtist),
        gt(songs.normalizedTitle, cursor.normalizedTitle),
      ),
      and(
        eq(songs.normalizedArtist, cursor.normalizedArtist),
        eq(songs.normalizedTitle, cursor.normalizedTitle),
        gt(songs.id, cursor.id),
      ),
    )!;
  }

  return or(
    gt(songs.normalizedTitle, cursor.normalizedTitle),
    and(
      eq(songs.normalizedTitle, cursor.normalizedTitle),
      gt(songs.normalizedArtist, cursor.normalizedArtist),
    ),
    and(
      eq(songs.normalizedTitle, cursor.normalizedTitle),
      eq(songs.normalizedArtist, cursor.normalizedArtist),
      gt(songs.id, cursor.id),
    ),
  )!;
}

function toPublicSongBrowseItem(
  row: SongBrowseRow,
): PublicSongBrowseItem {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    artist: row.artist,
    durationSeconds: row.durationSeconds,
    genres: row.genres,
    languages: row.languages,
    isDuet: row.isDuet,
    isExplicit: row.isExplicit,
    isPlus: row.isPlus,
    isHit: row.isHit,
  };
}

function toSongBrowseCursor(
  row: SongBrowseRow,
  sort: SongBrowseSort,
  filterKey: string,
): SongBrowseCursor {
  if (sort === "newest") {
    return {
      version: 1,
      filterKey,
      sort,
      id: row.id,
      createdAt: row.createdAt.toISOString(),
    };
  }

  return {
    version: 1,
    filterKey,
    sort,
    id: row.id,
    normalizedTitle: row.normalizedTitle,
    normalizedArtist: row.normalizedArtist,
  };
}

type SongBrowseRow = {
  id: number;
  source: "ising" | "karafun" | "manual";
  title: string;
  artist: string;
  durationSeconds: number | null;
  genres: string[];
  languages: string[];
  isDuet: boolean;
  isExplicit: boolean;
  isPlus: boolean;
  isHit: boolean;
  normalizedTitle: string;
  normalizedArtist: string;
  createdAt: Date;
};

export async function getSessionQueue(code: string) {
  return getQueueForLookup({ kind: "code", value: code });
}

export async function getPublicSessionQueue(publicToken: string) {
  return getQueueForLookup({ kind: "token", value: publicToken });
}

export async function getPublicSessionParticipant(
  publicToken: string,
  credential: string | null | undefined,
): Promise<PublicSessionParticipant | null> {
  const session = await requireLiveSession({
    kind: "token",
    value: publicToken,
  });

  return getPublicSessionParticipantForSession(session, credential);
}

async function getPublicSessionParticipantForSession(
  session: SessionEventRow,
  credential: string | null | undefined,
): Promise<PublicSessionParticipant | null> {
  const tokenHash = credential ? hashParticipantCredential(credential) : null;
  if (!tokenHash) return null;

  const now = new Date();
  const [membership] = await getDb()
    .select({
      displayName: eventParticipants.displayName,
      credentialId: participantCredentials.id,
    })
    .from(participantCredentials)
    .innerJoin(
      eventParticipants,
      eq(eventParticipants.participantId, participantCredentials.participantId),
    )
    .where(
      and(
        eq(participantCredentials.tokenHash, tokenHash),
        gt(participantCredentials.expiresAt, now),
        isNull(participantCredentials.revokedAt),
        eq(eventParticipants.eventSessionId, session.sessionId),
      ),
    )
    .limit(1);

  if (!membership) return null;

  await getDb()
    .update(participantCredentials)
    .set({ lastUsedAt: now })
    .where(eq(participantCredentials.id, membership.credentialId));

  return { displayName: membership.displayName };
}

export async function getPublicParticipantRequests(
  publicToken: string,
  credential: string | null | undefined,
): Promise<PublicParticipantRequest[]> {
  const session = await requireLiveSession({ kind: "token", value: publicToken });
  const membership = await requireParticipantMembership(
    session.sessionId,
    credential,
  );

  const rows = await getDb()
    .select({
      id: songRequests.publicId,
      title: songs.title,
      artist: songs.artist,
      status: songRequests.status,
      position: songRequests.position,
      createdAt: songRequests.createdAt,
    })
    .from(songRequests)
    .innerJoin(songs, eq(songs.id, songRequests.songId))
    .where(
      and(
        eq(songRequests.eventId, session.event.id),
        eq(songRequests.eventParticipantId, membership.id),
      ),
    )
    .orderBy(desc(songRequests.createdAt), desc(songRequests.id));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    status: row.status,
    queuePosition: row.status === "approved" ? row.position : null,
    isNext: row.status === "approved" && row.position === 1,
    createdAt: row.createdAt,
  }));
}

export async function renamePublicSessionParticipant(
  publicToken: string,
  credential: string | null | undefined,
  input: ParticipantRenameInput,
): Promise<PublicSessionParticipant> {
  try {
    return await getDb().transaction(async (transaction) => {
      const session = requireParticipantSessionRow(
        requireLiveSessionRow(
          await findSessionEventInTransaction(transaction, {
            kind: "token",
            value: publicToken,
          }),
        ),
      );
      const membership = await requireParticipantMembershipInTransaction(
        transaction,
        session.sessionId,
        credential,
      );
      const [updated] = await transaction
        .update(eventParticipants)
        .set({
          displayName: input.displayName,
          normalizedDisplayName: input.normalizedDisplayName,
          updatedAt: new Date(),
        })
        .where(eq(eventParticipants.id, membership.id))
        .returning({ displayName: eventParticipants.displayName });

      if (!updated) throw new Error("Participant membership could not be updated.");
      return updated;
    });
  } catch (error) {
    if (isNicknameUniqueViolation(error)) {
      throw new PublicApiError(
        409,
        "SESSION_NICKNAME_TAKEN",
        "This nickname is already used in the event.",
      );
    }
    throw error;
  }
}

export async function cancelPublicParticipantRequest(
  publicToken: string,
  credential: string | null | undefined,
  publicRequestId: string,
) {
  return getDb().transaction(async (transaction) => {
    const session = requireParticipantSessionRow(
      requireLiveSessionRow(
        await findSessionEventInTransaction(transaction, {
          kind: "token",
          value: publicToken,
        }),
      ),
    );
    const membership = await requireParticipantMembershipInTransaction(
      transaction,
      session.sessionId,
      credential,
    );
    const now = new Date();
    const [cancelled] = await transaction
      .update(songRequests)
      .set({
        status: "skipped",
        position: 0,
        completedAt: now,
        updatedAt: now,
        version: sql`${songRequests.version} + 1`,
      })
      .where(
        and(
          eq(songRequests.publicId, publicRequestId),
          eq(songRequests.eventId, session.event.id),
          eq(songRequests.eventParticipantId, membership.id),
          eq(songRequests.requestedBy, "public"),
          eq(songRequests.status, "pending"),
        ),
      )
      .returning({ id: songRequests.publicId, status: songRequests.status });

    if (cancelled) return cancelled;

    const [ownedRequest] = await transaction
      .select({ status: songRequests.status })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.publicId, publicRequestId),
          eq(songRequests.eventId, session.event.id),
          eq(songRequests.eventParticipantId, membership.id),
          eq(songRequests.requestedBy, "public"),
        ),
      )
      .limit(1);

    if (!ownedRequest) {
      throw new PublicApiError(
        404,
        "SESSION_REQUEST_NOT_FOUND",
        "The request does not exist.",
      );
    }

    throw new PublicApiError(
      409,
      "SESSION_REQUEST_CANNOT_CANCEL",
      "Only a pending request can be cancelled.",
    );
  });
}

export async function joinPublicSession(
  publicToken: string,
  credential: string | null | undefined,
  input: ParticipantJoinInput,
): Promise<ParticipantJoinResult> {
  const suppliedTokenHash = credential
    ? hashParticipantCredential(credential)
    : null;

  return getDb().transaction(async (transaction) => {
    const session = requireParticipantSessionRow(
      requireLiveSessionRow(
        await findSessionEventInTransaction(transaction, {
          kind: "token",
          value: publicToken,
        }),
      ),
    );
    const now = new Date();

    const [recognizedCredential] = suppliedTokenHash
      ? await transaction
          .select({
            participantId: participantCredentials.participantId,
            expiresAt: participantCredentials.expiresAt,
          })
          .from(participantCredentials)
          .where(
            and(
              eq(participantCredentials.tokenHash, suppliedTokenHash),
              gt(participantCredentials.expiresAt, now),
              isNull(participantCredentials.revokedAt),
            ),
          )
          .limit(1)
      : [];

    const rawCredential = recognizedCredential
      ? (credential as string)
      : generateParticipantCredential();
    const tokenHash = hashParticipantCredential(rawCredential);
    if (!tokenHash) throw new Error("Participant credential generation failed.");

    let participantId = recognizedCredential?.participantId;
    let credentialExpiresAt = recognizedCredential?.expiresAt;

    if (participantId) {
      await transaction
        .update(participantCredentials)
        .set({ lastUsedAt: now })
        .where(eq(participantCredentials.tokenHash, tokenHash));
    } else {
      const [identity] = await transaction
        .insert(participantIdentities)
        .values({ createdAt: now, updatedAt: now })
        .returning({ id: participantIdentities.id });

      if (!identity) throw new Error("Participant identity could not be created.");
      participantId = identity.id;
      credentialExpiresAt = new Date(now.getTime() + PARTICIPANT_CREDENTIAL_TTL_MS);

      const [createdCredential] = await transaction
        .insert(participantCredentials)
        .values({
          participantId,
          tokenHash,
          createdAt: now,
          lastUsedAt: now,
          expiresAt: credentialExpiresAt,
        })
        .onConflictDoNothing()
        .returning({ id: participantCredentials.id });

      if (!createdCredential) {
        throw new Error("Participant credential could not be created.");
      }
    }

    const [existingMembership] = await transaction
      .select({ displayName: eventParticipants.displayName })
      .from(eventParticipants)
      .where(
        and(
          eq(eventParticipants.eventSessionId, session.sessionId),
          eq(eventParticipants.participantId, participantId),
        ),
      )
      .limit(1);

    if (existingMembership) {
      return {
        participant: { displayName: existingMembership.displayName },
        credential: rawCredential,
        credentialExpiresAt: credentialExpiresAt as Date,
      };
    }

    const [membership] = await transaction
      .insert(eventParticipants)
      .values({
        eventSessionId: session.sessionId,
        participantId,
        displayName: input.displayName,
        normalizedDisplayName: input.normalizedDisplayName,
        joinedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ displayName: eventParticipants.displayName });

    if (!membership) {
      const [sameParticipantMembership] = await transaction
        .select({ displayName: eventParticipants.displayName })
        .from(eventParticipants)
        .where(
          and(
            eq(eventParticipants.eventSessionId, session.sessionId),
            eq(eventParticipants.participantId, participantId),
          ),
        )
        .limit(1);

      if (sameParticipantMembership) {
        return {
          participant: { displayName: sameParticipantMembership.displayName },
          credential: rawCredential,
          credentialExpiresAt: credentialExpiresAt as Date,
        };
      }

      throw new PublicApiError(
        409,
        "SESSION_NICKNAME_TAKEN",
        "This nickname is already used in the event.",
      );
    }

    return {
      participant: membership,
      credential: rawCredential,
      credentialExpiresAt: credentialExpiresAt as Date,
    };
  });
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

export async function createPublicSessionRequest(
  publicToken: string,
  credential: string | null | undefined,
  input: ParticipantSessionRequestInput,
) {
  const tokenHash = credential ? hashParticipantCredential(credential) : null;
  if (!tokenHash) {
    throw new PublicApiError(
      403,
      "SESSION_PARTICIPANT_REQUIRED",
      "Join this event before requesting a song.",
    );
  }

  return getDb().transaction(async (transaction) => {
    const session = await requireSongRequestSessionInTransaction(transaction, {
      kind: "token",
      value: publicToken,
    });
    const now = new Date();

    const [membership] = await transaction
      .select({
        id: eventParticipants.id,
        displayName: eventParticipants.displayName,
        credentialId: participantCredentials.id,
      })
      .from(participantCredentials)
      .innerJoin(
        eventParticipants,
        eq(eventParticipants.participantId, participantCredentials.participantId),
      )
      .where(
        and(
          eq(participantCredentials.tokenHash, tokenHash),
          gt(participantCredentials.expiresAt, now),
          isNull(participantCredentials.revokedAt),
          eq(eventParticipants.eventSessionId, session.sessionId),
        ),
      )
      .limit(1);

    if (!membership) {
      throw new PublicApiError(
        403,
        "SESSION_PARTICIPANT_REQUIRED",
        "Join this event before requesting a song.",
      );
    }

    await transaction
      .update(participantCredentials)
      .set({ lastUsedAt: now })
      .where(eq(participantCredentials.id, membership.credentialId));

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
          eq(songRequests.eventParticipantId, membership.id),
          inArray(songRequests.status, ACTIVE_PUBLIC_REQUEST_STATUSES),
        ),
      )
      .limit(1);

    if (duplicateRequest) {
      throw new PublicApiError(
        409,
        "SESSION_REQUEST_DUPLICATE",
        "This participant already has an active request for the selected song.",
      );
    }

    const [queueState] = await transaction
      .select({ maxPosition: max(songRequests.position) })
      .from(songRequests)
      .where(eq(songRequests.eventId, session.event.id));

    const [createdRequest] = await transaction
      .insert(songRequests)
      .values({
        eventId: session.event.id,
        songId: song.id,
        singerName: membership.displayName,
        displayName: membership.displayName,
        note: null,
        status: "pending",
        position: (queueState?.maxPosition ?? 0) + 1,
        requestedBy: "public",
        eventParticipantId: membership.id,
        updatedAt: now,
      })
      .returning({ id: songRequests.publicId, status: songRequests.status });

    if (!createdRequest) throw new Error("Session request could not be created.");
    return createdRequest;
  });
}

async function requireParticipantMembership(
  sessionId: number,
  credential: string | null | undefined,
) {
  const tokenHash = credential ? hashParticipantCredential(credential) : null;
  if (!tokenHash) throw participantRequiredError();
  const now = new Date();
  const [membership] = await getDb()
    .select({ id: eventParticipants.id, credentialId: participantCredentials.id })
    .from(participantCredentials)
    .innerJoin(
      eventParticipants,
      eq(eventParticipants.participantId, participantCredentials.participantId),
    )
    .where(
      and(
        eq(participantCredentials.tokenHash, tokenHash),
        gt(participantCredentials.expiresAt, now),
        isNull(participantCredentials.revokedAt),
        eq(eventParticipants.eventSessionId, sessionId),
      ),
    )
    .limit(1);
  if (!membership) throw participantRequiredError();
  return membership;
}

async function requireParticipantMembershipInTransaction(
  transaction: DatabaseTransaction,
  sessionId: number,
  credential: string | null | undefined,
) {
  const tokenHash = credential ? hashParticipantCredential(credential) : null;
  if (!tokenHash) throw participantRequiredError();
  const now = new Date();
  const [membership] = await transaction
    .select({ id: eventParticipants.id, credentialId: participantCredentials.id })
    .from(participantCredentials)
    .innerJoin(
      eventParticipants,
      eq(eventParticipants.participantId, participantCredentials.participantId),
    )
    .where(
      and(
        eq(participantCredentials.tokenHash, tokenHash),
        gt(participantCredentials.expiresAt, now),
        isNull(participantCredentials.revokedAt),
        eq(eventParticipants.eventSessionId, sessionId),
      ),
    )
    .limit(1);
  if (!membership) throw participantRequiredError();
  await transaction
    .update(participantCredentials)
    .set({ lastUsedAt: now })
    .where(eq(participantCredentials.id, membership.credentialId));
  return membership;
}

function participantRequiredError() {
  return new PublicApiError(
    403,
    "SESSION_PARTICIPANT_REQUIRED",
    "Join this event before using participant features.",
  );
}

function isNicknameUniqueViolation(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      current.code === "23505" &&
      (("constraint" in current &&
        current.constraint === "event_participants_session_nickname_idx") ||
        ("constraint_name" in current &&
          current.constraint_name === "event_participants_session_nickname_idx"))
    ) {
      return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : null;
  }
  return false;
}

async function requireLiveSession(lookup: SessionLookup) {
  const row = await findSessionEvent(lookup);
  return requireLiveSessionRow(row);
}

async function requireSongRequestSession(lookup: SessionLookup) {
  const session = await requireLiveSession(lookup);
  return requireSongRequestsEnabled(session);
}

function requireParticipantSessionRow(row: SessionEventRow) {
  if (
    !canUseSessionSongRequests(row.event) &&
    !canUseSessionPublicQueue(row.event)
  ) {
    throw new PublicApiError(
      403,
      "SESSION_PARTICIPATION_DISABLED",
      "Participant access is disabled for this event.",
    );
  }

  return row;
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
      sessionId: eventSessions.id,
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
      sessionId: eventSessions.id,
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
