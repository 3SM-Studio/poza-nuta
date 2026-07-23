import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import {
  eventSessionCodes,
  eventSessions,
  events,
} from "../db/schema";
import { getDb } from "./db";

export type EventSessionTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export async function insertEventSessionIdentity(
  transaction: EventSessionTransaction,
  input: {
    eventId: number;
    publicToken: string;
    sessionCode: string;
    createdByOperatorId: number | null;
    createdAt: Date;
  },
) {
  const [session] = await transaction
    .insert(eventSessions)
    .values({
      eventId: input.eventId,
      publicToken: input.publicToken,
      createdAt: input.createdAt,
    })
    .returning({ id: eventSessions.id, publicToken: eventSessions.publicToken });

  if (!session) throw new Error("Event session identity could not be created.");

  const [code] = await transaction
    .insert(eventSessionCodes)
    .values({
      sessionId: session.id,
      code: input.sessionCode,
      validFrom: input.createdAt,
      createdByOperatorId: input.createdByOperatorId,
      rotationReason: "initial",
      createdAt: input.createdAt,
    })
    .returning({ code: eventSessionCodes.code });

  if (!code) throw new Error("Initial event session code could not be created.");

  return { publicToken: session.publicToken, sessionCode: code.code };
}

export async function getEventSessionIdentityByEventId(
  transaction: EventSessionTransaction,
  eventId: number,
) {
  const [identity] = await transaction
    .select({
      sessionId: eventSessions.id,
      publicToken: eventSessions.publicToken,
      sessionCode: eventSessionCodes.code,
    })
    .from(eventSessions)
    .innerJoin(
      eventSessionCodes,
      and(
        eq(eventSessionCodes.sessionId, eventSessions.id),
        isNull(eventSessionCodes.validUntil),
        isNull(eventSessionCodes.revokedAt),
      ),
    )
    .where(eq(eventSessions.eventId, eventId))
    .limit(1);

  return identity ?? null;
}

export async function lockEventSessionIdentity(
  transaction: EventSessionTransaction,
  eventId: number,
) {
  const [identity] = await transaction
    .select({
      eventId: events.id,
      sessionId: eventSessions.id,
      publicToken: eventSessions.publicToken,
      codeId: eventSessionCodes.id,
      sessionCode: eventSessionCodes.code,
    })
    .from(events)
    .innerJoin(eventSessions, eq(eventSessions.eventId, events.id))
    .innerJoin(
      eventSessionCodes,
      and(
        eq(eventSessionCodes.sessionId, eventSessions.id),
        isNull(eventSessionCodes.validUntil),
        isNull(eventSessionCodes.revokedAt),
      ),
    )
    .where(eq(events.id, eventId))
    .for("update")
    .limit(1);

  return identity ?? null;
}

export async function publishEventSessionInvalidation(
  transaction: EventSessionTransaction,
  eventId: number,
  publicToken?: string,
) {
  const token =
    publicToken ??
    (await getEventSessionIdentityByEventId(transaction, eventId))?.publicToken;

  await transaction.execute(sql`
    select realtime.send(
      jsonb_build_object(
        'eventId', ${eventId}::integer,
        'type', 'queue_changed',
        'operation', 'UPDATE',
        'changedAt', statement_timestamp()
      ),
      'queue_changed',
      ${`dashboard:event:${eventId}:queue`},
      true
    )
  `);

  if (token) {
    await transaction.execute(sql`
      select realtime.send(
        jsonb_build_object(
          'type', 'queue_changed',
          'changedAt', statement_timestamp()
        ),
        'queue_changed',
        ${`public:session:${token}:queue`},
        true
      )
    `);
  }
}
