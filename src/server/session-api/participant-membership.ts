import "server-only";

import { and, eq, gt, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { eventParticipants, participantCredentials } from "../../db/schema";
import { getDb } from "../db";
import { PublicApiError } from "../public-api/errors";
import { hashParticipantCredential } from "./participant-credential";

export type ParticipantTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type MembershipReader = Pick<ReturnType<typeof getDb>, "select">;
const canonical = alias(eventParticipants, "canonical_participant");

export function participantRequiredError() {
  return new PublicApiError(403, "SESSION_PARTICIPANT_REQUIRED", "Join this event before using participant features.");
}

export async function findCredentialMembership(reader: MembershipReader, sessionId: number, credential: string | undefined | null) {
  const hash = credential ? hashParticipantCredential(credential) : null;
  if (!hash) return null;
  return readMembership(reader, sessionId, eq(participantCredentials.tokenHash, hash));
}

export async function findCredentialMembershipById(reader: MembershipReader, sessionId: number, credentialId: number) {
  return readMembership(reader, sessionId, eq(participantCredentials.id, credentialId));
}

async function readMembership(reader: MembershipReader, sessionId: number, credentialCondition: SQL) {
  const [row] = await reader.select({
    id: canonical.id, displayName: canonical.displayName, participantId: canonical.participantId,
    credentialId: participantCredentials.id, credentialParticipantId: participantCredentials.participantId,
    credentialExpiresAt: participantCredentials.expiresAt,
  }).from(participantCredentials)
    .innerJoin(eventParticipants, eq(eventParticipants.participantId, participantCredentials.participantId))
    .innerJoin(canonical, and(eq(canonical.id, sql`coalesce(${eventParticipants.mergedIntoId}, ${eventParticipants.id})`), eq(canonical.eventSessionId, eventParticipants.eventSessionId), isNull(canonical.mergedIntoId)))
    .where(and(credentialCondition, gt(participantCredentials.expiresAt, sql`clock_timestamp()`), isNull(participantCredentials.revokedAt), eq(eventParticipants.eventSessionId, sessionId))).limit(1);
  return row ?? null;
}

export async function lockCredentialMembership(transaction: ParticipantTransaction, sessionId: number, credential: string | undefined | null) {
  const hash = credential ? hashParticipantCredential(credential) : null;
  if (!hash) throw participantRequiredError();
  // Lock the credential alone FIRST. A joined membership snapshot taken before
  // waiting for a merge could still contain the retired source membership.
  const [locked] = await transaction.select({ id: participantCredentials.id }).from(participantCredentials)
    .where(and(eq(participantCredentials.tokenHash, hash), isNull(participantCredentials.revokedAt), gt(participantCredentials.expiresAt, sql`clock_timestamp()`)))
    .for("share").limit(1);
  if (!locked) throw participantRequiredError();
  const membership = await findCredentialMembership(transaction, sessionId, credential);
  if (!membership) throw participantRequiredError();
  return membership;
}

export async function findCanonicalMember(reader: MembershipReader, sessionId: number, memberId: number, lock = false) {
  const query = reader.select({ id: canonical.id, displayName: canonical.displayName, participantId: canonical.participantId })
    .from(eventParticipants).innerJoin(canonical, and(eq(canonical.id, sql`coalesce(${eventParticipants.mergedIntoId}, ${eventParticipants.id})`), eq(canonical.eventSessionId, eventParticipants.eventSessionId), isNull(canonical.mergedIntoId)))
    .where(and(eq(eventParticipants.id, memberId), eq(eventParticipants.eventSessionId, sessionId)));
  const [row] = await (lock ? query.for("share", { of: canonical }) : query).limit(1);
  return row ?? null;
}
