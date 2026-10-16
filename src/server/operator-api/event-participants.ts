import "server-only";

import { and, asc, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  eventParticipants, eventSessions, operatorAuditLog, participantIdentities,
  songRequests, songs,
} from "../../db/schema";
import { canManageDashboardEventQueue } from "../../lib/dashboard-event-queue";
import { ACTIVE_PARTICIPANT_REQUEST_STATUSES } from "../../lib/participant-request-policy";
import { getDb } from "../db";
import { setLocalDatabaseTimeouts } from "../database-transaction-timeouts";
import { requireParticipantRequestCapacity } from "../participant-request-limit";
import { searchCatalogSongs } from "../song-search";
import { OperatorApiError } from "./errors";
import { requireEventQueueManagerContext } from "./event-queue";
import { getDashboardOrganizationEventForAuthUser } from "./organizations";
import { validateParticipantJoinInput, validateParticipantSessionRequestInput } from "../session-api/validation";
import { getEventPresence } from "../session-api/presence";
import { findCanonicalMember } from "../session-api/participant-membership";

export type EventParticipantScope = {
  authUserId: string;
  organizationId: string;
  eventId: string;
};

async function requireReadableEvent(input: EventParticipantScope) {
  const context = await getDashboardOrganizationEventForAuthUser(input);
  if (!context) throw new OperatorApiError(404, "EVENT_NOT_FOUND", "Event was not found.");
  return context;
}

// Counts describe current request statuses, not immutable performance events.
// Restoring a done request removes it from completedCount. First appearance
// means no request currently in now/done, matching the existing domain rule.
export async function listEventParticipants(input: EventParticipantScope) {
  const context = await requireReadableEvent(input);
  const items = await getDb()
    .select({
      id: eventParticipants.id,
      displayName: eventParticipants.displayName,
      joinedAt: eventParticipants.joinedAt,
      activeCount: sql<number>`count(${songRequests.id}) filter (where ${inArray(songRequests.status, ACTIVE_PARTICIPANT_REQUEST_STATUSES)})::integer`,
      completedCount: sql<number>`count(${songRequests.id}) filter (where ${songRequests.status} = 'done')::integer`,
      hasPerformed: sql<boolean>`count(${songRequests.id}) filter (where ${songRequests.status} in ('now', 'done')) > 0`,
    })
    .from(eventParticipants)
    .innerJoin(eventSessions, eq(eventSessions.id, eventParticipants.eventSessionId))
    .leftJoin(songRequests, and(
      eq(songRequests.eventParticipantId, eventParticipants.id),
      eq(songRequests.eventId, context.event.id),
    ))
    .where(and(eq(eventSessions.eventId, context.event.id), isNull(eventParticipants.mergedIntoId)))
    .groupBy(eventParticipants.id)
    .orderBy(asc(eventParticipants.normalizedDisplayName), asc(eventParticipants.id));
  const presence = await getEventPresence(context.event.id);
  return {
    items: items.map(item => ({ ...item, online: !!presence.byId.get(item.id), onlineUntil: presence.byId.get(item.id) ?? null })),
    serverNow: presence.serverNow,
    nextPresenceCheckAt: presence.nextPresenceCheckAt,
    canManage: canManageDashboardEventQueue(context.organization.role) && context.event.effectiveStatus === "active",
    realtimeEventId: context.event.id,
  };
}

export async function getEventParticipant(input: EventParticipantScope & { participantId: number }) {
  const context = await requireReadableEvent(input);
  const requested = alias(eventParticipants, "requested_participant");
  const [participant] = await getDb().select({
    id: eventParticipants.id, displayName: eventParticipants.displayName, joinedAt: eventParticipants.joinedAt,
  }).from(eventParticipants)
    .innerJoin(eventSessions, eq(eventSessions.id, eventParticipants.eventSessionId))
    .innerJoin(requested, and(eq(requested.id, input.participantId), eq(requested.eventSessionId, eventParticipants.eventSessionId), eq(eventParticipants.id, sql`coalesce(${requested.mergedIntoId}, ${requested.id})`)))
    .where(eq(eventSessions.eventId, context.event.id))
    .limit(1);
  if (!participant) throw participantNotFound();
  const requests = await getDb().select({
    id: songRequests.id, title: songs.title, artist: songs.artist,
    status: songRequests.status, requestedBy: songRequests.requestedBy,
    createdAt: songRequests.createdAt, startedAt: songRequests.startedAt, completedAt: songRequests.completedAt,
  }).from(songRequests).innerJoin(songs, eq(songs.id, songRequests.songId))
    .where(and(eq(songRequests.eventId, context.event.id), eq(songRequests.eventParticipantId, participant.id)))
    .orderBy(desc(songRequests.createdAt), desc(songRequests.id));
  return { participant, requests };
}

export async function listEventParticipantPresence(input: EventParticipantScope) {
  const context = await requireReadableEvent(input);
  const presence = await getEventPresence(context.event.id);
  return {
    items: [...presence.byId].map(([id, onlineUntil]) => ({ id, online: !!onlineUntil, onlineUntil })),
    serverNow: presence.serverNow, nextPresenceCheckAt: presence.nextPresenceCheckAt,
  };
}

export async function searchEventParticipantSongs(input: EventParticipantScope & { query: string | null }) {
  await requireReadableEvent(input);
  return searchCatalogSongs(input.query);
}

export async function createEventParticipant(input: EventParticipantScope & { displayName: string }) {
  const validation = validateParticipantJoinInput({ displayName: input.displayName });
  if (!validation.success) throw new OperatorApiError(400, "VALIDATION_ERROR", "Invalid participant nickname.");
  return getDb().transaction(async (transaction) => {
    await setLocalDatabaseTimeouts(transaction);
    const context = await requireEventQueueManagerContext(transaction, input.authUserId, input.organizationId, input.eventId);
    const [session] = await transaction.select({ id: eventSessions.id }).from(eventSessions)
      .where(eq(eventSessions.eventId, context.event.id)).limit(1);
    if (!session) throw new OperatorApiError(409, "EVENT_SESSION_REQUIRED", "The event has no participant session.");
    const [identity] = await transaction.insert(participantIdentities).values({})
      .returning({ id: participantIdentities.id });
    const [participant] = await transaction.insert(eventParticipants).values({
      eventSessionId: session.id, participantId: identity.id, ...validation.data,
    }).onConflictDoNothing().returning({ id: eventParticipants.id, displayName: eventParticipants.displayName });
    if (!participant) throw new OperatorApiError(409, "SESSION_NICKNAME_TAKEN", "This nickname is already used in the event.");
    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator", operatorId: context.organization.operatorId,
      eventId: context.event.id, action: "event_participant_created", entityId: String(participant.id), payload: {},
    });
    return { participant };
  });
}

export async function createOperatorParticipantRequest(input: EventParticipantScope & { participantId: number; songId: number }) {
  const validation = validateParticipantSessionRequestInput({ songId: input.songId });
  if (!validation.success || !Number.isSafeInteger(input.participantId) || input.participantId <= 0) {
    throw new OperatorApiError(400, "VALIDATION_ERROR", "Invalid participant or song.");
  }
  return getDb().transaction(async (transaction) => {
    await setLocalDatabaseTimeouts(transaction);
    const context = await requireEventQueueManagerContext(transaction, input.authUserId, input.organizationId, input.eventId);
    const [storedParticipant] = await transaction.select({ id: eventParticipants.id, eventSessionId: eventParticipants.eventSessionId })
      .from(eventParticipants).innerJoin(eventSessions, eq(eventSessions.id, eventParticipants.eventSessionId))
      .where(and(eq(eventSessions.eventId, context.event.id), eq(eventParticipants.id, input.participantId)))
      .for("share", { of: eventParticipants }).limit(1);
    if (!storedParticipant) throw participantNotFound();
    const participant = await findCanonicalMember(transaction, storedParticipant.eventSessionId, storedParticipant.id, true);
    if (!participant) throw participantNotFound();
    const [song] = await transaction.select({ id: songs.id }).from(songs).where(eq(songs.id, input.songId)).limit(1);
    if (!song) throw new OperatorApiError(404, "SONG_NOT_FOUND", "The selected song does not exist.");
    const [duplicate] = await transaction.select({ id: songRequests.id }).from(songRequests).where(and(
      eq(songRequests.eventId, context.event.id), eq(songRequests.eventParticipantId, participant.id),
      eq(songRequests.songId, song.id), inArray(songRequests.status, ACTIVE_PARTICIPANT_REQUEST_STATUSES),
    )).limit(1);
    if (duplicate) throw new OperatorApiError(409, "QUEUE_ACTIVE_DUPLICATE", "This participant already has an active request for the selected song.");
    await requireParticipantRequestCapacity(transaction, context.event.id, participant.id, OperatorApiError);
    const [queueState] = await transaction.select({ maxPosition: max(songRequests.position) }).from(songRequests)
      .where(eq(songRequests.eventId, context.event.id));
    const [request] = await transaction.insert(songRequests).values({
      eventId: context.event.id, songId: song.id, eventParticipantId: participant.id,
      singerName: participant.displayName, displayName: participant.displayName,
      requestedBy: "operator", createdByOperatorId: context.organization.operatorId,
      status: "pending", position: (queueState.maxPosition ?? 0) + 1,
    }).returning({ id: songRequests.id, status: songRequests.status });
    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator", operatorId: context.organization.operatorId,
      eventId: context.event.id, action: "event_participant_request_created", entityId: String(request.id),
      payload: { eventParticipantId: participant.id, songId: song.id },
    });
    return { request };
  });
}

function participantNotFound() {
  return new OperatorApiError(404, "EVENT_PARTICIPANT_NOT_FOUND", "Participant was not found in this event.");
}
