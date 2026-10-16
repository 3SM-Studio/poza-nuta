import "server-only";

import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { eventParticipants, eventSessions, operatorAuditLog, participantConnections, participantCredentials, participantIdentities, participantMergeProposals, songRequests, songs } from "../../db/schema";
import { ACTIVE_PARTICIPANT_REQUEST_STATUSES } from "../../lib/participant-request-policy";
import { getDb } from "../db";
import { setLocalDatabaseTimeouts } from "../database-transaction-timeouts";
import { requireEventQueueManagerContext } from "./event-queue";
import { getDashboardOrganizationEventForAuthUser } from "./organizations";
import { OperatorApiError, type OperatorApiErrorStatus } from "./errors";
import type { EventParticipantScope } from "./event-participants";
import { databaseNow, isLinkId, requireLinkingContext } from "../session-api/linking";
import type { ParticipantTransaction } from "../session-api/participant-membership";
import { findCredentialMembershipById } from "../session-api/participant-membership";
import { PublicApiError } from "../public-api/errors";
import { getSessionEventAccessStatus } from "../../lib/session-event-access";

type Proposal = typeof participantMergeProposals.$inferSelect;

export async function createParticipantMergeProposal(input: EventParticipantScope & { sourceId: number; targetId: number }) {
  if (![input.sourceId, input.targetId].every(id => Number.isSafeInteger(id) && id > 0) || input.sourceId === input.targetId) throw mergeError("VALIDATION_ERROR", 400);
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const context = await requireEventQueueManagerContext(transaction, input.authUserId, input.organizationId, input.eventId);
    const [session] = await transaction.select({ id: eventSessions.id }).from(eventSessions).where(eq(eventSessions.eventId, context.event.id)).limit(1);
    if (!session) throw mergeError("EVENT_SESSION_REQUIRED");
    const members = await transaction.select().from(eventParticipants).where(and(eq(eventParticipants.eventSessionId, session.id), inArray(eventParticipants.id, [input.sourceId, input.targetId]), isNull(eventParticipants.mergedIntoId)))
      .orderBy(asc(eventParticipants.id)).for("share");
    const source = members.find(p => p.id === input.sourceId), target = members.find(p => p.id === input.targetId);
    if (!source || !target) throw mergeError("PARTICIPANT_MERGE_SCOPE", 404);
    const now = await databaseNow(transaction);
    if (getSessionEventAccessStatus({ event: context.event, now }) !== "active") throw mergeError("EVENT_QUEUE_CLOSED");
    const [{ count }] = await transaction.select({ count: sql<number>`count(*)::integer` }).from(participantMergeProposals)
      .where(and(eq(participantMergeProposals.eventSessionId, session.id), eq(participantMergeProposals.createdByOperatorId, context.organization.operatorId), sql`${participantMergeProposals.createdAt} > ${new Date(now.getTime() - 60_000).toISOString()}::timestamptz`));
    if (count >= 5) throw mergeError("SESSION_RATE_LIMITED", 429);
    const manual = await isManualGroup(transaction, session.id, source.id);
    const [proposal] = await transaction.insert(participantMergeProposals).values({
      eventSessionId: session.id, sourceId: source.id, targetId: target.id,
      sourceUpdatedAt: source.updatedAt, targetUpdatedAt: target.updatedAt,
      sourceConsentRequired: !manual, createdByOperatorId: context.organization.operatorId,
      createdAt: now, expiresAt: new Date(now.getTime() + 300_000),
    }).returning();
    await transaction.insert(operatorAuditLog).values({ actorKind: "operator", operatorId: context.organization.operatorId, eventId: context.event.id,
      action: "participant_merge_proposed", entityId: proposal.id, payload: { sourceId: source.id, targetId: target.id, sourceConsentRequired: !manual } });
    return proposalView(transaction, proposal, context.event.id);
  });
}

export async function getParticipantMergeProposal(input: EventParticipantScope & { proposalId: string }) {
  if (!isLinkId(input.proposalId)) throw mergeError("VALIDATION_ERROR", 400);
  const context = await getDashboardOrganizationEventForAuthUser(input);
  if (!context) throw mergeError("EVENT_NOT_FOUND", 404);
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const proposal = await scopedProposal(transaction, input.proposalId, context.event.id);
    return proposalView(transaction, proposal, context.event.id);
  });
}

export async function completeParticipantMerge(input: EventParticipantScope & { proposalId: string; action: "complete" | "cancel" }) {
  if (!isLinkId(input.proposalId)) throw mergeError("VALIDATION_ERROR", 400);
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const context = await requireEventQueueManagerContext(transaction, input.authUserId, input.organizationId, input.eventId);
    const initial = await scopedProposal(transaction, input.proposalId, context.event.id);
    if (initial.completedAt) return { completed: true, targetParticipantId: initial.targetId };
    // Identity guards stop new credential issuance while the full credential
    // set is locked. NO KEY UPDATE stays compatible with ordinary FK checks.
    const group = await transaction.select().from(eventParticipants).where(and(eq(eventParticipants.eventSessionId, initial.eventSessionId),
      or(inArray(eventParticipants.id, [initial.sourceId, initial.targetId]), inArray(eventParticipants.mergedIntoId, [initial.sourceId, initial.targetId])))).orderBy(asc(eventParticipants.id));
    const identities = [...new Set(group.map(p => p.participantId))].sort((a, b) => a - b);
    if (!identities.length) throw mergeError("PARTICIPANT_MERGE_STALE");
    await transaction.select({ id: participantIdentities.id }).from(participantIdentities).where(inArray(participantIdentities.id, identities)).orderBy(asc(participantIdentities.id)).for("no key update");
    await transaction.select({ id: participantCredentials.id }).from(participantCredentials).where(inArray(participantCredentials.participantId, identities)).orderBy(asc(participantCredentials.id)).for("update");
    const members = await transaction.select().from(eventParticipants).where(inArray(eventParticipants.id, group.map(p => p.id))).orderBy(asc(eventParticipants.id)).for("update");
    const proposal = await scopedProposal(transaction, initial.id, context.event.id, true);
    const now = await databaseNow(transaction);
    if (proposal.completedAt) return { completed: true, targetParticipantId: proposal.targetId };
    if (getSessionEventAccessStatus({ event: context.event, now }) !== "active") throw mergeError("EVENT_QUEUE_CLOSED");
    if (proposal.cancelledAt) throw mergeError("PARTICIPANT_MERGE_CANCELLED");
    if (input.action === "cancel") {
      await transaction.update(participantMergeProposals).set({ cancelledAt: now }).where(eq(participantMergeProposals.id, proposal.id));
      await transaction.insert(operatorAuditLog).values({ actorKind: "operator", operatorId: context.organization.operatorId, eventId: context.event.id, action: "participant_merge_cancelled", entityId: proposal.id, payload: {} });
      return { completed: false, targetParticipantId: proposal.targetId };
    }
    const source = members.find(p => p.id === proposal.sourceId), target = members.find(p => p.id === proposal.targetId);
    if (!source || !target || source.mergedIntoId !== null || target.mergedIntoId !== null || source.updatedAt.getTime() !== proposal.sourceUpdatedAt.getTime() || target.updatedAt.getTime() !== proposal.targetUpdatedAt.getTime()) throw mergeError("PARTICIPANT_MERGE_STALE");
    if (proposal.expiresAt <= now) throw mergeError("PARTICIPANT_MERGE_EXPIRED");
    if (!proposal.sourceConsentRequired && !await isManualGroup(transaction, proposal.eventSessionId, source.id)) throw mergeError("PARTICIPANT_MERGE_STALE");
    if ((proposal.sourceConsentRequired && !await validConsent(transaction, proposal.eventSessionId, source.id, proposal.sourceConsentCredentialId)) || !await validConsent(transaction, proposal.eventSessionId, target.id, proposal.targetConsentCredentialId)) throw mergeError("PARTICIPANT_MERGE_CONSENT_REQUIRED");
    const view = await proposalView(transaction, proposal, context.event.id);
    if (view.conflict === "limit") throw mergeError("PARTICIPANT_MERGE_LIMIT");
    if (view.conflict === "duplicate") throw mergeError("PARTICIPANT_MERGE_DUPLICATE");
    const sourceIds = members.filter(p => p.id === source.id || p.mergedIntoId === source.id).map(p => p.id);
    // All involved credential locks are now exclusive, so Presence/rename and
    // fresh credential issuance cannot race the atomic reparenting below.
    const movedRequests = await transaction.update(songRequests).set({ eventParticipantId: target.id })
      .where(and(eq(songRequests.eventId, context.event.id), inArray(songRequests.eventParticipantId, sourceIds))).returning({ id: songRequests.id, sourceId: sql<number>`${source.id}` });
    const movedConnections = await transaction.update(participantConnections).set({ eventParticipantId: target.id })
      .where(inArray(participantConnections.eventParticipantId, sourceIds)).returning({ id: participantConnections.id });
    const oldAliases = members.filter(p => p.mergedIntoId === source.id);
    if (oldAliases.length) await transaction.update(eventParticipants).set({ mergedIntoId: target.id }).where(inArray(eventParticipants.id, oldAliases.map(p => p.id)));
    await transaction.update(eventParticipants).set({ mergedIntoId: target.id, mergedAt: now, updatedAt: now }).where(eq(eventParticipants.id, source.id));
    await transaction.update(participantMergeProposals).set({ completedAt: now, completedByOperatorId: context.organization.operatorId }).where(eq(participantMergeProposals.id, proposal.id));
    const auditRows = movedRequests.map(request => ({ actorKind: "operator" as const, operatorId: context.organization.operatorId, eventId: context.event.id,
      action: "participant_request_merged", entityId: String(request.id), payload: { proposalId: proposal.id, sourceId: source.id, targetId: target.id } }));
    if (auditRows.length) await transaction.insert(operatorAuditLog).values(auditRows);
    for (const old of oldAliases) await transaction.insert(operatorAuditLog).values({ actorKind: "operator", operatorId: context.organization.operatorId, eventId: context.event.id, action: "participant_alias_retargeted", entityId: String(old.id), payload: { proposalId: proposal.id, sourceId: source.id, targetId: target.id } });
    await transaction.insert(operatorAuditLog).values({ actorKind: "operator", operatorId: context.organization.operatorId, eventId: context.event.id,
      action: "participant_event_merged", entityId: proposal.id, payload: { sourceId: source.id, targetId: target.id, movedRequests: movedRequests.length, movedConnections: movedConnections.length } });
    // 0028's membership trigger invalidates participants; explicitly invalidate
    // the public data API also when a merge has no song_requests to move.
    const [session] = await transaction.select({ token: eventSessions.publicToken }).from(eventSessions).where(eq(eventSessions.id, proposal.eventSessionId));
    await transaction.execute(sql`select realtime.send(jsonb_build_object('type', 'queue_changed', 'changedAt', clock_timestamp(), 'reason', 'capabilities_changed'),
      'queue_changed', ${`public:session:${session.token}:queue`}, true)`);
    return { completed: true, targetParticipantId: target.id };
  });
}

export async function getOwnMergeProposals(publicToken: string, credential: string | null | undefined) {
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const { session, member, now } = await requireLinkingContext(transaction, publicToken, credential);
    const proposals = await transaction.select().from(participantMergeProposals).where(and(eq(participantMergeProposals.eventSessionId, session.sessionId),
      or(eq(participantMergeProposals.sourceId, member.id), eq(participantMergeProposals.targetId, member.id)), isNull(participantMergeProposals.cancelledAt), isNull(participantMergeProposals.completedAt), sql`${participantMergeProposals.expiresAt} > ${now.toISOString()}::timestamptz`))
      .orderBy(desc(participantMergeProposals.createdAt)).limit(5);
    const items = [];
    for (const proposal of proposals) items.push(await proposalView(transaction, proposal, session.event.id));
    return { items };
  });
}

export async function consentParticipantMerge(publicToken: string, credential: string | null | undefined, id: string, approve: boolean) {
  if (!isLinkId(id)) throw new PublicApiError(400, "VALIDATION_ERROR", "Invalid proposal.");
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const { session, member } = await requireLinkingContext(transaction, publicToken, credential);
    const initial = await scopedProposal(transaction, id, session.event.id);
    if (member.id !== initial.sourceId && member.id !== initial.targetId) throw new PublicApiError(403, "PARTICIPANT_MERGE_FORBIDDEN", "This proposal does not belong to you.");
    await transaction.select({ id: eventParticipants.id }).from(eventParticipants).where(inArray(eventParticipants.id, [initial.sourceId, initial.targetId])).orderBy(asc(eventParticipants.id)).for("share");
    const proposal = await scopedProposal(transaction, id, session.event.id, true);
    const now = await databaseNow(transaction);
    const view = await proposalView(transaction, proposal, session.event.id);
    if (getSessionEventAccessStatus({ event: session.event, now }) !== "active") throw new PublicApiError(409, "SESSION_EVENT_CLOSED", "The event is closed.");
    if (proposal.completedAt || proposal.cancelledAt || proposal.expiresAt <= now || view.stale) throw new PublicApiError(409, "PARTICIPANT_MERGE_STALE", "This proposal is no longer available.");
    const source = member.id === proposal.sourceId;
    await transaction.update(participantMergeProposals).set(!approve ? { cancelledAt: now } : source ? { sourceConsentCredentialId: member.credentialId, sourceConsentedAt: now } : { targetConsentCredentialId: member.credentialId, targetConsentedAt: now }).where(eq(participantMergeProposals.id, id));
    await transaction.insert(operatorAuditLog).values({ actorKind: "system", operatorId: null, eventId: session.event.id,
      action: approve ? "participant_merge_consented" : "participant_merge_declined", entityId: id, payload: { initiator: "participant", credentialId: member.credentialId, side: source ? "source" : "target" } });
    return { approved: approve };
  });
}

async function isManualGroup(transaction: ParticipantTransaction, sessionId: number, sourceId: number) {
  const [row] = await transaction.execute<{ manual: boolean }>(sql`select not exists (
    select 1 from public.participant_credentials pc join public.event_participants ep on ep.participant_id = pc.participant_id
    where ep.event_session_id = ${sessionId} and coalesce(ep.merged_into_id, ep.id) = ${sourceId}
  ) and not exists (select 1 from public.song_requests where event_participant_id = ${sourceId} and requested_by = 'public') as manual`);
  return row.manual;
}
async function validConsent(transaction: ParticipantTransaction, sessionId: number, memberId: number, credentialId: number | null) {
  if (!credentialId) return false;
  const membership = await findCredentialMembershipById(transaction, sessionId, credentialId);
  return membership?.id === memberId;
}
async function scopedProposal(transaction: ParticipantTransaction, id: string, eventId: number, lock = false) {
  const query = transaction.select({ proposal: participantMergeProposals }).from(participantMergeProposals)
    .innerJoin(eventSessions, eq(eventSessions.id, participantMergeProposals.eventSessionId))
    .where(and(eq(participantMergeProposals.id, id), eq(eventSessions.eventId, eventId)));
  const [row] = await (lock ? query.for("update", { of: participantMergeProposals }) : query).limit(1);
  if (!row) throw mergeError("PARTICIPANT_MERGE_NOT_FOUND", 404);
  return row.proposal;
}
async function proposalView(transaction: ParticipantTransaction, proposal: Proposal, eventId: number) {
  const members = await transaction.select().from(eventParticipants).where(and(eq(eventParticipants.eventSessionId, proposal.eventSessionId), inArray(eventParticipants.id, [proposal.sourceId, proposal.targetId])));
  const source = members.find(p => p.id === proposal.sourceId), target = members.find(p => p.id === proposal.targetId);
  if (!source || !target) throw mergeError("PARTICIPANT_MERGE_NOT_FOUND", 404);
  const requests = await transaction.select({ id: songRequests.publicId, memberId: songRequests.eventParticipantId, songId: songRequests.songId, title: songs.title, artist: songs.artist, status: songRequests.status, createdAt: songRequests.createdAt, completedAt: songRequests.completedAt })
    .from(songRequests).innerJoin(songs, eq(songs.id, songRequests.songId)).where(and(eq(songRequests.eventId, eventId), inArray(songRequests.eventParticipantId, [source.id, target.id]))).orderBy(desc(songRequests.createdAt));
  const active = requests.filter(request => ACTIVE_PARTICIPANT_REQUEST_STATUSES.some(status => status === request.status));
  const duplicate = new Set(active.map(request => request.songId)).size !== active.length;
  const profile = (id: number, displayName: string) => ({ displayName, activeCount: active.filter(request => request.memberId === id).length,
    requests: requests.filter(request => request.memberId === id).map(({ id, title, artist, status, createdAt, completedAt }) => ({ id, title, artist, status, createdAt, completedAt })) });
  return { id: proposal.id, source: profile(source.id, source.displayName), target: profile(target.id, target.displayName),
    sourceConsentRequired: proposal.sourceConsentRequired, sourceConsented: !!proposal.sourceConsentedAt, targetConsented: !!proposal.targetConsentedAt,
    expiresAt: proposal.expiresAt, completedAt: proposal.completedAt, cancelledAt: proposal.cancelledAt,
    stale: source.mergedIntoId !== null || target.mergedIntoId !== null || source.updatedAt.getTime() !== proposal.sourceUpdatedAt.getTime() || target.updatedAt.getTime() !== proposal.targetUpdatedAt.getTime(),
    conflict: active.length > 2 ? "limit" as const : duplicate ? "duplicate" as const : null };
}
function mergeError(code: string, status: OperatorApiErrorStatus = 409) { return new OperatorApiError(status, code, "The participant merge could not be completed."); }
