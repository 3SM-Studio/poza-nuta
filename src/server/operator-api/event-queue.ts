import "server-only";

import { and, asc, eq, max, sql } from "drizzle-orm";

import {
  canApplyDashboardEventQueueAction,
  canManageDashboardEventQueue,
  canReorderDashboardEventQueueRequest,
  getDashboardEventQueueTargetStatus,
  type DashboardEventQueueAction,
  type DashboardEventQueueMoveDirection,
} from "../../lib/dashboard-event-queue";
import {
  events,
  operatorAuditLog,
  operatorUsers,
  songRequests,
  songs,
  workspaceMembers,
  workspaces,
} from "../../db/schema";
import { isOrganizationPublicId } from "../../lib/organization-public-id";
import { parseDashboardEventIdentifier } from "../../lib/dashboard-event-identifier";
import { getEffectiveEventLifecycleStatus } from "../../lib/effective-event-lifecycle";
import { getDb } from "../db";
import {
  getDashboardOrganizationEventForAuthUser,
} from "./organizations";
import { OperatorApiError } from "./errors";

type DatabaseTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

const dashboardEventQueueItemSelection = {
  id: songRequests.id,
  eventId: songRequests.eventId,
  songId: songRequests.songId,
  singerName: songRequests.singerName,
  displayName: songRequests.displayName,
  note: songRequests.note,
  status: songRequests.status,
  position: songRequests.position,
  requestedBy: songRequests.requestedBy,
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

type DashboardEventQueueItemRow = {
  id: number;
  eventId: number;
  songId: number;
  singerName: string;
  displayName: string;
  note: string | null;
  status: "pending" | "approved" | "now" | "done" | "skipped" | "rejected";
  position: number;
  requestedBy: "public" | "operator";
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

export type DashboardEventQueueItem = ReturnType<
  typeof toDashboardEventQueueItem
>;

export async function getDashboardOrganizationEventQueueForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: string | number;
}) {
  const result = await getDashboardOrganizationEventForAuthUser(input);

  if (!result) {
    return null;
  }

  const rows = await getDb()
    .select(dashboardEventQueueItemSelection)
    .from(songRequests)
    .innerJoin(songs, eq(songs.id, songRequests.songId))
    .where(eq(songRequests.eventId, result.event.id))
    .orderBy(asc(songRequests.createdAt), asc(songRequests.id));

  return {
    ...result,
    canManage: canManageDashboardEventQueue(result.organization.role),
    items: rows
      .map(toDashboardEventQueueItem)
      .sort(compareDashboardEventQueueItems),
  };
}

export async function applyDashboardOrganizationEventQueueActionForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: string | number;
  requestId: number;
  action: DashboardEventQueueAction;
}) {
  return getDb().transaction(async (transaction) => {
    const context = await requireEventQueueManagerContext(
      transaction,
      input.authUserId,
      input.organizationId,
      input.eventId,
    );
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
          eq(songRequests.id, input.requestId),
          eq(songRequests.eventId, context.event.id),
        ),
      )
      .for("update")
      .limit(1);

    if (!queueRequest) {
      throw new OperatorApiError(
        404,
        "REQUEST_NOT_FOUND",
        "The request does not belong to this event.",
      );
    }

    if (
      !canApplyDashboardEventQueueAction(input.action, queueRequest.status)
    ) {
      throw new OperatorApiError(
        409,
        "INVALID_STATUS_TRANSITION",
        `The ${input.action} action cannot be applied to a ${queueRequest.status} request.`,
      );
    }

    const changedAt = new Date();
    const completedNowRequestCount =
      input.action === "start"
        ? await completeCurrentEventQueueRequests(
            transaction,
            context.event.id,
            changedAt,
          )
        : 0;
    const targetStatus = getDashboardEventQueueTargetStatus(input.action);
    let targetPosition = 0;

    if (targetStatus === "approved") {
      const [queueState] = await transaction
        .select({ maxPosition: max(songRequests.position) })
        .from(songRequests)
        .where(
          and(
            eq(songRequests.eventId, context.event.id),
            eq(songRequests.status, "approved"),
          ),
        );

      targetPosition = (queueState?.maxPosition ?? 0) + 1;
    }

    const [changedRequest] = await transaction
      .update(songRequests)
      .set({
        status: targetStatus,
        position: targetPosition,
        updatedAt: changedAt,
        version: sql`${songRequests.version} + 1`,
        ...(input.action === "start"
          ? { startedAt: changedAt, completedAt: null }
          : {}),
        ...(input.action === "done" ? { completedAt: changedAt } : {}),
        ...(input.action === "restore"
          ? { startedAt: null, completedAt: null }
          : {}),
      })
      .where(
        and(
          eq(songRequests.id, queueRequest.id),
          eq(songRequests.eventId, context.event.id),
          eq(songRequests.version, queueRequest.version),
        ),
      )
      .returning({ id: songRequests.id });

    if (!changedRequest) {
      throw new OperatorApiError(
        409,
        "QUEUE_ACTION_CONFLICT",
        "The request changed before the action could be applied.",
      );
    }

    if (
      queueRequest.status === "approved" ||
      targetStatus === "approved"
    ) {
      await renumberApprovedQueue(
        transaction,
        context.event.id,
        changedAt,
      );
    }

    const updatedRequest = await requireDashboardEventQueueItem(
      transaction,
      context.event.id,
      queueRequest.id,
    );

    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator",
      operatorId: context.organization.operatorId,
      eventId: context.event.id,
      action: `event_queue_${input.action}`,
      entityId: String(queueRequest.id),
      payload: {
        previousStatus: queueRequest.status,
        nextStatus: targetStatus,
        previousPosition: queueRequest.position,
        nextPosition: updatedRequest.position,
        previousVersion: queueRequest.version,
        nextVersion: updatedRequest.version,
        ...(input.action === "start"
          ? { completedNowRequestCount }
          : {}),
      },
    });

    return {
      event: context.event,
      request: updatedRequest,
    };
  });
}

export async function moveDashboardOrganizationEventQueueRequestForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: string | number;
  requestId: number;
  direction: DashboardEventQueueMoveDirection;
}) {
  return getDb().transaction(async (transaction) => {
    const context = await requireEventQueueManagerContext(
      transaction,
      input.authUserId,
      input.organizationId,
      input.eventId,
    );
    const lockedApprovedRequests = await transaction
      .select({
        id: songRequests.id,
        status: songRequests.status,
        position: songRequests.position,
        version: songRequests.version,
        createdAt: songRequests.createdAt,
      })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.eventId, context.event.id),
          eq(songRequests.status, "approved"),
        ),
      )
      .orderBy(asc(songRequests.id))
      .for("update");
    const orderedRequests = [...lockedApprovedRequests].sort(
      compareApprovedQueueRows,
    );
    const currentIndex = orderedRequests.findIndex(
      (request) => request.id === input.requestId,
    );

    if (currentIndex < 0) {
      const [existingRequest] = await transaction
        .select({ status: songRequests.status })
        .from(songRequests)
        .where(
          and(
            eq(songRequests.id, input.requestId),
            eq(songRequests.eventId, context.event.id),
          ),
        )
        .limit(1);

      if (!existingRequest) {
        throw new OperatorApiError(
          404,
          "REQUEST_NOT_FOUND",
          "The request does not belong to this event.",
        );
      }

      throw new OperatorApiError(
        409,
        "QUEUE_REQUEST_NOT_REORDERABLE",
        "Only approved requests can be reordered.",
      );
    }

    if (
      !canReorderDashboardEventQueueRequest(
        orderedRequests[currentIndex].status,
      )
    ) {
      throw new OperatorApiError(
        409,
        "QUEUE_REQUEST_NOT_REORDERABLE",
        "Only approved requests can be reordered.",
      );
    }

    const targetIndex =
      input.direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (targetIndex < 0 || targetIndex >= orderedRequests.length) {
      return {
        moved: false as const,
        event: context.event,
        request: await requireDashboardEventQueueItem(
          transaction,
          context.event.id,
          input.requestId,
        ),
      };
    }

    const previousPosition = currentIndex + 1;
    const targetRequest = orderedRequests[currentIndex];
    const neighborRequest = orderedRequests[targetIndex];
    [orderedRequests[currentIndex], orderedRequests[targetIndex]] = [
      neighborRequest,
      targetRequest,
    ];
    const changedAt = new Date();
    const positionUpdates = orderedRequests
      .map((request, index) => ({
        id: request.id,
        previousPosition: request.position,
        position: index + 1,
      }))
      .filter((request) => request.previousPosition !== request.position)
      .sort((left, right) => left.id - right.id);

    for (const request of positionUpdates) {
      await transaction
        .update(songRequests)
        .set({
          position: request.position,
          updatedAt: changedAt,
          version: sql`${songRequests.version} + 1`,
        })
        .where(
          and(
            eq(songRequests.id, request.id),
            eq(songRequests.eventId, context.event.id),
            eq(songRequests.status, "approved"),
          ),
        );
    }

    const updatedRequest = await requireDashboardEventQueueItem(
      transaction,
      context.event.id,
      input.requestId,
    );

    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator",
      operatorId: context.organization.operatorId,
      eventId: context.event.id,
      action: "move_event_queue_request",
      entityId: String(input.requestId),
      payload: {
        direction: input.direction,
        previousPosition,
        nextPosition: updatedRequest.position,
      },
    });

    return {
      moved: true as const,
      event: context.event,
      request: updatedRequest,
    };
  });
}

async function completeCurrentEventQueueRequests(
  transaction: DatabaseTransaction,
  eventId: number,
  changedAt: Date,
) {
  const currentRequests = await transaction
    .select({
      id: songRequests.id,
      version: songRequests.version,
    })
    .from(songRequests)
    .where(
      and(
        eq(songRequests.eventId, eventId),
        eq(songRequests.status, "now"),
      ),
    )
    .orderBy(asc(songRequests.id))
    .for("update");

  for (const request of currentRequests) {
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
          eq(songRequests.id, request.id),
          eq(songRequests.eventId, eventId),
          eq(songRequests.status, "now"),
          eq(songRequests.version, request.version),
        ),
      );
  }

  return currentRequests.length;
}

async function requireEventQueueManagerContext(
  transaction: DatabaseTransaction,
  authUserId: string,
  organizationId: string,
  eventId: string | number,
) {
  if (!isOrganizationPublicId(organizationId)) {
    throw new OperatorApiError(
      404,
      "WORKSPACE_NOT_FOUND",
      "Organization was not found.",
    );
  }

  const [organization] = await transaction
    .select({
      id: workspaces.id,
      publicId: workspaces.publicId,
      role: workspaceMembers.role,
      operatorId: operatorUsers.id,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.workspaceId, workspaces.id),
    )
    .innerJoin(
      operatorUsers,
      eq(operatorUsers.id, workspaceMembers.operatorUserId),
    )
    .where(
      and(
        eq(workspaces.publicId, organizationId),
        eq(workspaces.active, true),
        eq(operatorUsers.authUserId, authUserId),
        eq(operatorUsers.active, true),
        eq(workspaceMembers.active, true),
      ),
    )
    .limit(1);

  if (
    !organization ||
    !canManageDashboardEventQueue(organization.role)
  ) {
    throw new OperatorApiError(
      403,
      "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN",
      "Only an owner, manager, or operator can manage the event queue.",
    );
  }

  const [event] = await transaction
    .select({
      id: events.id,
      name: events.name,
      status: events.status,
      startsAt: events.startsAt,
      autoCloseAt: events.autoCloseAt,
      endsAt: events.endsAt,
      closedAt: events.closedAt,
    })
    .from(events)
    .where(
      and(
        getEventIdentifierCondition(eventId),
        eq(events.workspaceId, organization.id),
      ),
    )
    .for("update")
    .limit(1);

  if (!event) {
    throw new OperatorApiError(
      404,
      "EVENT_NOT_FOUND",
      "Event was not found.",
    );
  }

  if (getEffectiveEventLifecycleStatus(event) !== "active") {
    throw new OperatorApiError(
      409,
      "EVENT_QUEUE_CLOSED",
      "The event queue is closed.",
    );
  }

  return {
    organization,
    event,
  };
}

function getEventIdentifierCondition(eventId: string | number) {
  const identifier = parseDashboardEventIdentifier(eventId);
  if (!identifier) return sql`false`;

  return identifier.kind === "public"
    ? eq(events.publicId, identifier.value)
    : eq(events.id, identifier.value);
}

async function requireDashboardEventQueueItem(
  transaction: DatabaseTransaction,
  eventId: number,
  requestId: number,
) {
  const [row] = await transaction
    .select(dashboardEventQueueItemSelection)
    .from(songRequests)
    .innerJoin(songs, eq(songs.id, songRequests.songId))
    .where(
      and(
        eq(songRequests.id, requestId),
        eq(songRequests.eventId, eventId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new OperatorApiError(
      404,
      "REQUEST_NOT_FOUND",
      "The request does not belong to this event.",
    );
  }

  return toDashboardEventQueueItem(row);
}

async function renumberApprovedQueue(
  transaction: DatabaseTransaction,
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
          eq(songRequests.status, "approved"),
        ),
      );
  }
}

function toDashboardEventQueueItem(row: DashboardEventQueueItemRow) {
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

function compareDashboardEventQueueItems(
  left: DashboardEventQueueItem,
  right: DashboardEventQueueItem,
) {
  const statusRank = {
    now: 0,
    pending: 1,
    approved: 2,
    rejected: 3,
    done: 4,
    skipped: 5,
  } as const;
  const rankDifference = statusRank[left.status] - statusRank[right.status];

  if (rankDifference !== 0) {
    return rankDifference;
  }

  if (left.status === "approved") {
    return left.position - right.position || left.id - right.id;
  }

  if (
    left.status === "done" ||
    left.status === "skipped" ||
    left.status === "rejected"
  ) {
    return (
      right.updatedAt.getTime() - left.updatedAt.getTime() ||
      right.id - left.id
    );
  }

  return (
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id - right.id
  );
}

function compareApprovedQueueRows(
  left: {
    id: number;
    position: number;
    createdAt: Date;
  },
  right: {
    id: number;
    position: number;
    createdAt: Date;
  },
) {
  return (
    left.position - right.position ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id - right.id
  );
}
