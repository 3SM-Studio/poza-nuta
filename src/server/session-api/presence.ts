import "server-only";

import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { participantConnections, participantCredentials } from "../../db/schema";
import type { ParticipantPresenceInput } from "../../lib/participant-presence";
import { isParticipantPresenceInput, PARTICIPANT_PRESENCE_TTL_MS } from "../../lib/participant-presence";
import { getDb } from "../db";
import { setLocalDatabaseTimeouts } from "../database-transaction-timeouts";
import { PublicApiError } from "../public-api/errors";
import { hashParticipantCredential } from "./participant-credential";
import { requirePresenceSessionInTransaction } from "./service";
import { getSessionEventAccessStatus } from "../../lib/session-event-access";
import { lockCredentialMembership } from "./participant-membership";

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function mutateParticipantPresence(publicToken: string, credential: string | undefined | null, input: ParticipantPresenceInput) {
  if (!isParticipantPresenceInput(input)) throw new PublicApiError(400, "VALIDATION_ERROR", "Invalid connection.");
  const hash = credential ? hashParticipantCredential(credential) : null;
  if (!hash) throw participantRequired();
  return getDb().transaction(async (transaction) => {
    await setLocalDatabaseTimeouts(transaction);
    const session = await requirePresenceSessionInTransaction(transaction, publicToken);
    const membership = await lockCredentialMembership(transaction, session.sessionId, credential);
    // A separate advisory namespace serializes ONLY this member's leases.
    // No song request/session queue lock, and no membership row update/broadcast.
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`presence-credential:${membership.credentialId}`}, 0))`);
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`participant-presence:${membership.id}`}, 0))`);
    const [{ now }] = await transaction.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
    const serverNow = new Date(now);
    if (membership.credentialExpiresAt <= serverNow) throw participantRequired();
    if (getSessionEventAccessStatus({ event: session.event, now: serverNow }) !== "active") {
      throw new PublicApiError(403, "SESSION_EVENT_CLOSED", "The event is closed.");
    }
    const before = await memberOnline(transaction, membership.id, serverNow);
    const [existing] = await transaction.select().from(participantConnections)
      .where(eq(participantConnections.id, input.connectionId)).limit(1);
    if (existing && (existing.eventParticipantId !== membership.id || existing.credentialId !== membership.credentialId)) {
      throw participantRequired();
    }
    if (!existing && input.action !== "heartbeat") {
      // Shared, database-backed limit survives Vercel instance changes and NAT.
      const [{ count }] = await transaction.select({ count: sql<number>`count(*)::integer` }).from(participantConnections)
        .where(and(eq(participantConnections.credentialId, membership.credentialId), gt(participantConnections.createdAt, new Date(serverNow.getTime() - 60_000))));
      if (count >= 32) throw new PublicApiError(429, "SESSION_RATE_LIMITED", "Too many connections.");
    }
    if (input.action === "connect" && !existing) {
      await transaction.insert(participantConnections).values({
        id: input.connectionId, eventParticipantId: membership.id, credentialId: membership.credentialId,
        createdAt: serverNow, heartbeatAt: serverNow, expiresAt: new Date(serverNow.getTime() + PARTICIPANT_PRESENCE_TTL_MS),
      });
    } else if (input.action === "disconnect") {
      // A beacon may overtake the initial connect. Keep a tombstone in either order.
      await transaction.insert(participantConnections).values({
        id: input.connectionId, eventParticipantId: membership.id, credentialId: membership.credentialId,
        createdAt: serverNow, heartbeatAt: serverNow, expiresAt: serverNow, disconnectedAt: serverNow,
      }).onConflictDoUpdate({ target: participantConnections.id, set: { disconnectedAt: serverNow } });
    } else if (!existing || existing.disconnectedAt) {
      throw new PublicApiError(409, "SESSION_CONNECTION_ENDED", "Open a new connection.");
    } else if (serverNow.getTime() - existing.heartbeatAt.getTime() >= 5_000) {
      await transaction.update(participantConnections).set({ heartbeatAt: serverNow, expiresAt: new Date(serverNow.getTime() + PARTICIPANT_PRESENCE_TTL_MS) })
        .where(eq(participantConnections.id, input.connectionId));
    }
    if (!existing && input.action !== "heartbeat") {
      // Retention covers both new leases and beacon-before-connect tombstones.
      await transaction.execute(sql`delete from public.participant_connections where id in (
        select id from public.participant_connections where expires_at < ${new Date(serverNow.getTime() - 86_400_000).toISOString()}::timestamptz
        order by expires_at limit 1000 for update skip locked)`);
    }
    const after = await memberOnline(transaction, membership.id, serverNow);
    // A shorter aggregate deadline must re-arm dashboards even if another tab
    // keeps the person online. Heartbeat extensions remain silent.
    if (!!before !== !!after || (before && after && after < before)) await transaction.execute(sql`select realtime.send(
      jsonb_build_object('eventId', ${session.event.id}::bigint, 'type', 'participants_changed', 'operation', 'UPDATE', 'changedAt', clock_timestamp()),
      'participants_changed', ${`dashboard:event:${session.event.id}:participants`}, true)`);
    return { online: !!after, serverNow: serverNow.toISOString(), heartbeatAfterMs: 15_000 };
  });
}

async function memberOnline(transaction: Transaction, memberId: number, now: Date) {
  const [row] = await transaction.select({ until: sql<string | null>`max(least(${participantConnections.expiresAt}, ${participantCredentials.expiresAt}))::text` }).from(participantConnections)
    .innerJoin(participantCredentials, eq(participantCredentials.id, participantConnections.credentialId))
    .where(and(eq(participantConnections.eventParticipantId, memberId), isNull(participantConnections.disconnectedAt),
      gt(participantConnections.expiresAt, now), isNull(participantCredentials.revokedAt), gt(participantCredentials.expiresAt, now)));
  return row?.until ? Date.parse(row.until) : null;
}

// One aggregate query for the whole event; never N+1. The database clock is
// authoritative, including credential expiry and the event's automatic close.
export async function getEventPresence(eventId: number) {
  const rows = await getDb().execute<{ id: number; until: string | null; now: string }>(sql`
    with clock as (select clock_timestamp() as now)
    select ep.id::integer as id, clock.now::text as now,
      max(least(c.expires_at, pc.expires_at, coalesce(e.auto_close_at, e.ends_at))) filter (
        where c.disconnected_at is null and c.expires_at > clock.now
        and pc.revoked_at is null and pc.expires_at > clock.now
        and exists (select 1 from public.event_participants owned where owned.participant_id = pc.participant_id
          and owned.event_session_id = ep.event_session_id and coalesce(owned.merged_into_id, owned.id) = ep.id)
        and e.status not in ('closed', 'cancelled') and e.closed_at is null
        and e.starts_at <= clock.now and coalesce(e.auto_close_at, e.ends_at) > clock.now
      )::text as until
    from public.event_participants ep
    join public.event_sessions es on es.id = ep.event_session_id
    join public.events e on e.id = es.event_id cross join clock
    left join public.participant_connections c on c.event_participant_id = ep.id
    left join public.participant_credentials pc on pc.id = c.credential_id
    where e.id = ${eventId} and ep.merged_into_id is null group by ep.id, clock.now`);
  const byId = new Map(rows.map(row => [row.id, row.until ? new Date(row.until).toISOString() : null]));
  const deadlines = [...byId.values()].filter((value): value is string => value !== null).sort();
  // Empty list needs no timer and exposes no connection details.
  return { byId, serverNow: rows[0] ? new Date(rows[0].now).toISOString() : new Date().toISOString(), nextPresenceCheckAt: deadlines[0] ?? null };
}

function participantRequired() {
  return new PublicApiError(403, "SESSION_PARTICIPANT_REQUIRED", "Join this event before using participant features.");
}
