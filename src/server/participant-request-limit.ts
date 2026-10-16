import "server-only";

import { and, count, eq, inArray } from "drizzle-orm";

import { songRequests } from "../db/schema";
import {
  ACTIVE_PARTICIPANT_REQUEST_STATUSES,
  PARTICIPANT_ACTIVE_REQUEST_LIMIT,
} from "../lib/participant-request-policy";
import type { getDb } from "./db";

type DatabaseTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

// Call only for an insert or an inactive -> active transition, after acquiring
// the event's session queue mutex. Keep the check and write in that transaction.
export async function requireParticipantRequestCapacity(
  transaction: DatabaseTransaction,
  eventId: number,
  eventParticipantId: number,
  ErrorType: new (status: 409, code: string, message: string) => Error,
) {
  const [row] = await transaction
    .select({ activeCount: count() })
    .from(songRequests)
    .where(and(
      eq(songRequests.eventId, eventId),
      eq(songRequests.eventParticipantId, eventParticipantId),
      inArray(songRequests.status, ACTIVE_PARTICIPANT_REQUEST_STATUSES),
    ));

  if (row.activeCount >= PARTICIPANT_ACTIVE_REQUEST_LIMIT) {
    throw new ErrorType(
      409,
      "SESSION_REQUEST_LIMIT_REACHED",
      "A participant can have at most two active requests in this event.",
    );
  }
}
