import "server-only";

import { and, asc, eq, max, sql } from "drizzle-orm";

import {
  events,
  operatorAuditLog,
  songRequests,
  songs,
} from "../../db/schema";
import { getDb } from "../db";
import {
  closeExpiredActiveEventInTransaction,
  getActiveEventAfterLazyClose,
} from "../event-lifecycle";
import { OperatorApiError } from "./errors";
import {
  canApplyQueueAction,
  getTargetStatus,
  type OperatorQueueAction,
} from "./transitions";

const activePublicEventFilter = and(
  eq(events.isActivePublicEvent, true),
  eq(events.status, "active"),
);

const operatorQueueItemSelection = {
  id: songRequests.id,
  eventId: songRequests.eventId,
  songId: songRequests.songId,
  singerName: songRequests.singerName,
  displayName: songRequests.displayName,
  note: songRequests.note,
  status: songRequests.status,
  position: songRequests.position,
  requestedBy: songRequests.requestedBy,
  createdByOperatorId: songRequests.createdByOperatorId,
  version: songRequests.version,
  createdAt: songRequests.createdAt,
  updatedAt: songRequests.updatedAt,
  startedAt: songRequests.startedAt,
  completedAt: songRequests.completedAt,
  songTitle: songs.title,
  songArtist: songs.artist,
  songSource: songs.source,
  durationSeconds: songs.durationSeconds,
};

export async function getOperatorQueue() {
  const event = await getActiveEventAfterLazyClose();

  if (!event) {
    throw new OperatorApiError(
      404,
      "ACTIVE_EVENT_NOT_FOUND",
      "No active public event is available.",
    );
  }

  const rows = await getDb()
    .select(operatorQueueItemSelection)
    .from(songRequests)
    .innerJoin(songs, eq(songRequests.songId, songs.id))
    .where(eq(songRequests.eventId, event.id))
    .orderBy(asc(songRequests.createdAt), asc(songRequests.id));
  const items = rows.map(toOperatorQueueItem);

  return {
    event,
    queue: {
      pending: items.filter((item) => item.status === "pending"),
      now: items.filter((item) => item.status === "now"),
      approved: items
        .filter((item) => item.status === "approved")
        .sort(byPosition),
      done: items
        .filter((item) => item.status === "done")
        .sort(byUpdatedAtDescending),
      skipped: items
        .filter((item) => item.status === "skipped")
        .sort(byUpdatedAtDescending),
      rejected: items
        .filter((item) => item.status === "rejected")
        .sort(byUpdatedAtDescending),
    },
  };
}

export async function applyOperatorQueueAction(
  action: OperatorQueueAction,
  requestId: number,
  operatorId: number,
) {
  return getDb().transaction(async (transaction) => {
    await closeExpiredActiveEventInTransaction(transaction);

    const [event] = await transaction
      .select({
        id: events.id,
        name: events.name,
      })
      .from(events)
      .where(activePublicEventFilter)
      .for("update")
      .limit(1);

    if (!event) {
      throw new OperatorApiError(
        404,
        "ACTIVE_EVENT_NOT_FOUND",
        "No active public event is available.",
      );
    }

    const [queueRequest] = await transaction
      .select({
        id: songRequests.id,
        status: songRequests.status,
        position: songRequests.position,
        version: songRequests.version,
      })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.id, requestId),
          eq(songRequests.eventId, event.id),
        ),
      )
      .for("update")
      .limit(1);

    if (!queueRequest) {
      throw new OperatorApiError(
        404,
        "REQUEST_NOT_FOUND",
        "The request does not belong to the active public event.",
      );
    }

    if (!canApplyQueueAction(action, queueRequest.status)) {
      throw new OperatorApiError(
        409,
        "INVALID_STATUS_TRANSITION",
        `The ${action} action cannot be applied to a ${queueRequest.status} request.`,
      );
    }

    const changedAt = new Date();
    let completedNowRequestCount = 0;

    if (action === "start") {
      const activeNowRequests = await transaction
        .select({
          id: songRequests.id,
          version: songRequests.version,
        })
        .from(songRequests)
        .where(
          and(
            eq(songRequests.eventId, event.id),
            eq(songRequests.status, "now"),
          ),
        )
        .orderBy(asc(songRequests.id))
        .for("update");

      for (const activeNow of activeNowRequests) {
        await transaction
          .update(songRequests)
          .set({
            status: "done",
            position: 0,
            completedAt: changedAt,
            updatedAt: changedAt,
            version: sql`${songRequests.version} + 1`,
          })
          .where(
            and(
              eq(songRequests.id, activeNow.id),
              eq(songRequests.eventId, event.id),
              eq(songRequests.status, "now"),
              eq(songRequests.version, activeNow.version),
            ),
          );
      }

      completedNowRequestCount = activeNowRequests.length;
    }

    const targetStatus = getTargetStatus(action);
    let targetPosition = 0;

    if (action === "approve") {
      const [queueState] = await transaction
        .select({ maxPosition: max(songRequests.position) })
        .from(songRequests)
        .where(
          and(
            eq(songRequests.eventId, event.id),
            eq(songRequests.status, "approved"),
          ),
        );

      targetPosition = (queueState?.maxPosition ?? 0) + 1;
    }

    await transaction
      .update(songRequests)
      .set({
        status: targetStatus,
        position: targetPosition,
        updatedAt: changedAt,
        version: sql`${songRequests.version} + 1`,
        ...(action === "start" ? { startedAt: changedAt } : {}),
        ...(action === "done" ? { completedAt: changedAt } : {}),
      })
      .where(
        and(
          eq(songRequests.id, queueRequest.id),
          eq(songRequests.eventId, event.id),
          eq(songRequests.version, queueRequest.version),
        ),
      );

    if (
      action === "approve" ||
      action === "reject" ||
      action === "start" ||
      action === "skip"
    ) {
      await renumberApprovedQueue(transaction, event.id, changedAt);
    }

    const [updatedRequest] = await transaction
      .select(operatorQueueItemSelection)
      .from(songRequests)
      .innerJoin(songs, eq(songRequests.songId, songs.id))
      .where(
        and(
          eq(songRequests.id, queueRequest.id),
          eq(songRequests.eventId, event.id),
        ),
      )
      .limit(1);

    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator",
      operatorId,
      eventId: event.id,
      action,
      entityId: String(queueRequest.id),
      payload: {
        previousStatus: queueRequest.status,
        nextStatus: targetStatus,
        previousPosition: queueRequest.position,
        nextPosition: updatedRequest.position,
        previousVersion: queueRequest.version,
        nextVersion: updatedRequest.version,
        ...(action === "start"
          ? { completedNowRequestCount }
          : {}),
      },
    });

    return {
      event: {
        id: event.id,
        name: event.name,
      },
      request: toOperatorQueueItem(updatedRequest),
    };
  });
}

type OperatorQueueRow = {
  id: number;
  eventId: number;
  songId: number;
  singerName: string;
  displayName: string;
  note: string | null;
  status: "pending" | "approved" | "now" | "done" | "skipped" | "rejected";
  position: number;
  requestedBy: "public" | "operator";
  createdByOperatorId: number | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  songTitle: string;
  songArtist: string;
  songSource: "ising" | "karafun" | "manual";
  durationSeconds: number | null;
};

function toOperatorQueueItem(row: OperatorQueueRow) {
  return {
    id: row.id,
    eventId: row.eventId,
    songId: row.songId,
    singerName: row.singerName,
    displayName: row.displayName,
    note: row.note,
    status: row.status,
    position: row.position,
    requestedBy: row.requestedBy,
    createdByOperatorId: row.createdByOperatorId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    song: {
      title: row.songTitle,
      artist: row.songArtist,
      source: row.songSource,
      durationSeconds: row.durationSeconds,
    },
  };
}

function byPosition(
  left: ReturnType<typeof toOperatorQueueItem>,
  right: ReturnType<typeof toOperatorQueueItem>,
) {
  return left.position - right.position || left.id - right.id;
}

function byUpdatedAtDescending(
  left: ReturnType<typeof toOperatorQueueItem>,
  right: ReturnType<typeof toOperatorQueueItem>,
) {
  return (
    right.updatedAt.getTime() - left.updatedAt.getTime() ||
    right.id - left.id
  );
}

async function renumberApprovedQueue(
  transaction: Parameters<
    Parameters<ReturnType<typeof getDb>["transaction"]>[0]
  >[0],
  eventId: number,
  changedAt: Date,
) {
  const approvedRequests = await transaction
    .select({
      id: songRequests.id,
      position: songRequests.position,
    })
    .from(songRequests)
    .where(
      and(
        eq(songRequests.eventId, eventId),
        eq(songRequests.status, "approved"),
      ),
    )
    .orderBy(
      asc(songRequests.position),
      asc(songRequests.createdAt),
      asc(songRequests.id),
    );

  for (const [index, request] of approvedRequests.entries()) {
    const position = index + 1;

    if (request.position === position) {
      continue;
    }

    await transaction
      .update(songRequests)
      .set({
        position,
        updatedAt: changedAt,
        version: sql`${songRequests.version} + 1`,
      })
      .where(
        and(
          eq(songRequests.id, request.id),
          eq(songRequests.eventId, eventId),
        ),
      );
  }
}
