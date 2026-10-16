import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { eventParticipants, operatorAuditLog, participantCredentials, participantDeviceLinks, participantIdentities } from "../../db/schema";
import { getDb } from "../db";
import { setLocalDatabaseTimeouts } from "../database-transaction-timeouts";
import { PublicApiError } from "../public-api/errors";
import { findCredentialMembership, lockCredentialMembership, participantRequiredError, type ParticipantTransaction } from "./participant-membership";
import { generateParticipantCredential, hashParticipantCredential, isParticipantCredential, PARTICIPANT_CREDENTIAL_TTL_MS } from "./participant-credential";
import { requirePresenceSessionInTransaction } from "./service";
import { getSessionEventAccessStatus } from "../../lib/session-event-access";

export const LINK_CHALLENGE_COOKIE = "poza_nuta_device_link";
const LINK_TTL_MS = 180_000;
export const linkHash = (kind: string, value: string) => createHash("sha256").update(`${kind}:${value}`).digest("hex");
const comparisonCode = (challenge: string, id: string) => (parseInt(linkHash("comparison", `${id}:${challenge}`).slice(0, 8), 16) % 1_000_000).toString().padStart(6, "0");
export const isLinkId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function databaseNow(transaction: ParticipantTransaction) {
  const [row] = await transaction.execute<{ now: string }>(sql`select clock_timestamp()::text as now`);
  return new Date(row.now);
}

function requireActiveEvent(session: Awaited<ReturnType<typeof requirePresenceSessionInTransaction>>, now: Date) {
  if (getSessionEventAccessStatus({ event: session.event, now }) !== "active") throw linkError("SESSION_EVENT_CLOSED");
}

export async function requireLinkingContext(transaction: ParticipantTransaction, publicToken: string, credential: string | null | undefined) {
  const session = await requirePresenceSessionInTransaction(transaction, publicToken);
  const hash = credential ? hashParticipantCredential(credential) : null;
  if (!hash) throw participantRequiredError();
  const [candidate] = await transaction.select({ participantId: participantCredentials.participantId }).from(participantCredentials)
    .where(eq(participantCredentials.tokenHash, hash)).limit(1);
  if (!candidate) throw participantRequiredError();
  await transaction.select({ id: participantIdentities.id }).from(participantIdentities)
    .where(eq(participantIdentities.id, candidate.participantId)).for("share");
  const member = await lockCredentialMembership(transaction, session.sessionId, credential);
  const now = await databaseNow(transaction);
  if (getSessionEventAccessStatus({ event: session.event, now }) !== "active") throw linkError("SESSION_EVENT_CLOSED");
  return { session, member, now };
}

async function publicAudit(transaction: ParticipantTransaction, eventId: number, action: string, id: string, credentialId: number | null, payload: Record<string, unknown> = {}) {
  await transaction.insert(operatorAuditLog).values({ actorKind: "system", operatorId: null, eventId, action,
    entityId: id, payload: { initiator: "participant", credentialId, ...payload } });
}

export async function issueDeviceLink(publicToken: string, credential: string | null | undefined) {
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const { session, member } = await requireLinkingContext(transaction, publicToken, credential);
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`device-link:${member.credentialParticipantId}`}, 0))`);
    const now = await databaseNow(transaction);
    requireActiveEvent(session, now);
    const [{ count }] = await transaction.select({ count: sql<number>`count(*)::integer` }).from(participantDeviceLinks)
      .where(and(eq(participantDeviceLinks.participantId, member.credentialParticipantId), gt(participantDeviceLinks.createdAt, new Date(now.getTime() - 60_000))));
    if (count >= 5) throw new PublicApiError(429, "SESSION_RATE_LIMITED", "Too many linking invitations.");
    const token = generateParticipantCredential();
    const [link] = await transaction.insert(participantDeviceLinks).values({
      eventSessionId: session.sessionId, participantId: member.credentialParticipantId,
      issuerCredentialId: member.credentialId, tokenHash: linkHash("invitation", token),
      createdAt: now, expiresAt: new Date(now.getTime() + LINK_TTL_MS),
    }).returning({ id: participantDeviceLinks.id, expiresAt: participantDeviceLinks.expiresAt });
    await publicAudit(transaction, session.event.id, "participant_device_link_issued", link.id, member.credentialId);
    return { link: { ...link, status: "waiting" }, token };
  });
}

export async function prepareDeviceLink(publicToken: string, credential: string | null | undefined, token: string, suppliedChallenge: string | undefined) {
  if (!isParticipantCredential(token)) throw linkError();
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const session = await requirePresenceSessionInTransaction(transaction, publicToken);
    const [link] = await transaction.select().from(participantDeviceLinks)
      .where(and(eq(participantDeviceLinks.tokenHash, linkHash("invitation", token)), eq(participantDeviceLinks.eventSessionId, session.sessionId)))
      .for("update").limit(1);
    const now = await databaseNow(transaction);
    requireActiveEvent(session, now);
    requireOpenLink(link, now);
    const existing = await readValidCredential(transaction, credential);
    if (existing) throw linkError(existing.participantId === link.participantId ? "SESSION_DEVICE_ALREADY_LINKED" : "SESSION_LINK_IDENTITY_CONFLICT");
    const [issuer] = await transaction.select({ id: participantCredentials.id }).from(participantCredentials)
      .where(and(eq(participantCredentials.id, link.issuerCredentialId ?? -1), eq(participantCredentials.participantId, link.participantId), isNull(participantCredentials.revokedAt), gt(participantCredentials.expiresAt, now))).limit(1);
    if (!issuer) throw linkError();
    if (link.challengeHash && (!isParticipantCredential(suppliedChallenge) || link.challengeHash !== linkHash("challenge", suppliedChallenge))) throw linkError("SESSION_LINK_ALREADY_CLAIMED");
    const challenge = link.challengeHash ? suppliedChallenge! : generateParticipantCredential();
    const code = comparisonCode(challenge, link.id);
    if (!link.challengeHash) {
      await transaction.update(participantDeviceLinks).set({ challengeHash: linkHash("challenge", challenge), verificationHash: linkHash("approval", `${link.id}:${code}`) })
        .where(eq(participantDeviceLinks.id, link.id));
      await publicAudit(transaction, session.event.id, "participant_device_link_claimed", link.id, null);
    }
    return { link: { id: link.id, expiresAt: link.expiresAt, comparisonCode: code, status: link.approvedAt ? "approved" : "waiting_approval" }, challenge };
  });
}

export async function approveDeviceLink(publicToken: string, credential: string | null | undefined, id: string, code: string) {
  if (!isLinkId(id) || !/^\d{6}$/.test(code)) throw linkError();
  const result = await getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const { session, member } = await requireLinkingContext(transaction, publicToken, credential);
    const [link] = await transaction.select().from(participantDeviceLinks).where(and(eq(participantDeviceLinks.id, id), eq(participantDeviceLinks.eventSessionId, session.sessionId)))
      .for("update").limit(1);
    const now = await databaseNow(transaction);
    requireActiveEvent(session, now);
    requireOpenLink(link, now);
    if (link.issuerCredentialId !== member.credentialId || link.participantId !== member.credentialParticipantId || !link.challengeHash || !link.verificationHash) throw linkError();
    if (link.approvalAttempts >= 5) throw new PublicApiError(429, "SESSION_RATE_LIMITED", "Too many confirmation attempts.");
    if (!timingSafeEqual(Buffer.from(link.verificationHash, "hex"), Buffer.from(linkHash("approval", `${link.id}:${code}`), "hex"))) {
      await transaction.update(participantDeviceLinks).set({ approvalAttempts: link.approvalAttempts + 1 }).where(eq(participantDeviceLinks.id, id));
      return { mismatch: true as const };
    }
    if (!link.approvedAt) {
      await transaction.update(participantDeviceLinks).set({ approvedAt: now }).where(eq(participantDeviceLinks.id, id));
      await publicAudit(transaction, session.event.id, "participant_device_link_approved", id, member.credentialId);
    }
    return { mismatch: false as const };
  });
  // Keep failed attempt counters committed; throwing inside would roll them back.
  if (result.mismatch) throw linkError("SESSION_LINK_CONFIRMATION_MISMATCH");
  return { approved: true };
}

export async function finishDeviceLink(publicToken: string, credential: string | null | undefined, id: string, challenge: string | undefined) {
  if (!isLinkId(id) || !isParticipantCredential(challenge)) throw linkError();
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const session = await requirePresenceSessionInTransaction(transaction, publicToken);
    const [candidate] = await transaction.select().from(participantDeviceLinks).where(and(eq(participantDeviceLinks.id, id), eq(participantDeviceLinks.eventSessionId, session.sessionId))).limit(1);
    if (!candidate) throw linkError();
    await transaction.select({ id: participantIdentities.id }).from(participantIdentities).where(eq(participantIdentities.id, candidate.participantId)).for("share");
    const [issuer] = await transaction.select().from(participantCredentials).where(eq(participantCredentials.id, candidate.issuerCredentialId ?? -1)).for("share").limit(1);
    const [link] = await transaction.select().from(participantDeviceLinks).where(eq(participantDeviceLinks.id, id)).for("update").limit(1);
    const now = await databaseNow(transaction);
    requireActiveEvent(session, now);
    if (link.challengeHash !== linkHash("challenge", challenge) || link.cancelledAt) throw linkError();
    const rawCredential = createHash("sha256").update(`participant-device-credential:${link.id}:${challenge}`).digest("base64url");
    const hash = hashParticipantCredential(rawCredential)!;
    const current = await readValidCredential(transaction, credential);
    if (current && current.id !== link.issuedCredentialId) throw linkError("SESSION_LINK_IDENTITY_CONFLICT");
    if (link.consumedAt) {
      if (now.getTime() - link.consumedAt.getTime() > 600_000) throw linkError("SESSION_LINK_USED");
      const [receipt] = await transaction.select().from(participantCredentials).where(and(eq(participantCredentials.id, link.issuedCredentialId ?? -1), eq(participantCredentials.tokenHash, hash), isNull(participantCredentials.revokedAt), gt(participantCredentials.expiresAt, now))).limit(1);
      if (!receipt) throw linkError("SESSION_LINK_USED");
      return { credential: rawCredential, credentialExpiresAt: receipt.expiresAt };
    }
    requireOpenLink(link, now);
    if (!link.approvedAt) throw linkError("SESSION_LINK_APPROVAL_REQUIRED");
    if (!issuer || issuer.participantId !== link.participantId || issuer.revokedAt || issuer.expiresAt <= now) throw linkError();
    const [ownMembership] = await transaction.select({ id: eventParticipants.id }).from(eventParticipants)
      .where(and(eq(eventParticipants.eventSessionId, session.sessionId), eq(eventParticipants.participantId, link.participantId))).limit(1);
    if (!ownMembership) throw linkError();
    const expiresAt = new Date(now.getTime() + PARTICIPANT_CREDENTIAL_TTL_MS);
    const [issued] = await transaction.insert(participantCredentials).values({ participantId: link.participantId, tokenHash: hash, createdAt: now, lastUsedAt: now, expiresAt }).returning({ id: participantCredentials.id });
    await transaction.update(participantDeviceLinks).set({ consumedAt: now, issuedCredentialId: issued.id }).where(eq(participantDeviceLinks.id, id));
    await publicAudit(transaction, session.event.id, "participant_device_link_consumed", id, issued.id);
    return { credential: rawCredential, credentialExpiresAt: expiresAt };
  });
}

export async function getDeviceLinkState(publicToken: string, credential: string | null | undefined, challenge: string | undefined) {
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const session = await requirePresenceSessionInTransaction(transaction, publicToken);
    const member = await findCredentialMembership(transaction, session.sessionId, credential);
    const issued = member ? await transaction.select().from(participantDeviceLinks)
      .where(and(eq(participantDeviceLinks.eventSessionId, session.sessionId), eq(participantDeviceLinks.issuerCredentialId, member.credentialId)))
      .orderBy(desc(participantDeviceLinks.createdAt)).limit(5) : [];
    const [received] = isParticipantCredential(challenge) ? await transaction.select().from(participantDeviceLinks)
      .where(and(eq(participantDeviceLinks.eventSessionId, session.sessionId), eq(participantDeviceLinks.challengeHash, linkHash("challenge", challenge)))).limit(1) : [];
    const now = await databaseNow(transaction);
    const status = (link: typeof participantDeviceLinks.$inferSelect) => link.cancelledAt ? "cancelled" : link.consumedAt ? "used" : link.expiresAt <= now ? "expired" : link.approvedAt ? "approved" : link.challengeHash ? "waiting_approval" : "waiting";
    return { issued: issued.map(link => ({ id: link.id, expiresAt: link.expiresAt, status: status(link) })),
      received: received ? { id: received.id, expiresAt: received.expiresAt, status: status(received), comparisonCode: comparisonCode(challenge!, received.id) } : null };
  });
}

export async function cancelDeviceLink(publicToken: string, credential: string | null | undefined, id: string) {
  if (!isLinkId(id)) throw linkError();
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const { session, member, now } = await requireLinkingContext(transaction, publicToken, credential);
    const [link] = await transaction.select().from(participantDeviceLinks).where(and(eq(participantDeviceLinks.id, id), eq(participantDeviceLinks.eventSessionId, session.sessionId), eq(participantDeviceLinks.issuerCredentialId, member.credentialId))).for("update").limit(1);
    if (!link || link.consumedAt) throw linkError("SESSION_LINK_USED");
    await transaction.update(participantDeviceLinks).set({ cancelledAt: now }).where(eq(participantDeviceLinks.id, id));
    await publicAudit(transaction, session.event.id, "participant_device_link_cancelled", id, member.credentialId);
    return { cancelled: true };
  });
}

async function readValidCredential(transaction: ParticipantTransaction, credential: string | null | undefined) {
  const hash = credential ? hashParticipantCredential(credential) : null;
  if (!hash) return null;
  const [row] = await transaction.select().from(participantCredentials).where(and(eq(participantCredentials.tokenHash, hash), isNull(participantCredentials.revokedAt), gt(participantCredentials.expiresAt, sql`clock_timestamp()`))).limit(1);
  return row ?? null;
}

function requireOpenLink(link: typeof participantDeviceLinks.$inferSelect | undefined, now: Date): asserts link is typeof participantDeviceLinks.$inferSelect {
  if (!link || link.cancelledAt) throw linkError();
  if (link.consumedAt) throw linkError("SESSION_LINK_USED");
  if (link.expiresAt <= now) throw linkError("SESSION_LINK_EXPIRED");
}
function linkError(code = "SESSION_LINK_INVALID") { return new PublicApiError(409, code, "The device link could not be completed."); }
