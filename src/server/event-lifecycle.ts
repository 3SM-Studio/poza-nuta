import "server-only";

import { and, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

import { events, operatorAuditLog, workspaces } from "../db/schema";
import { calculateAutoCloseAt } from "../lib/event-lifecycle";
import { DEFAULT_WORKSPACE_HANDLE } from "../lib/workspace";
import { getDb } from "./db";
import { OperatorApiError } from "./operator-api/errors";
import type {
  EventSettingsInput,
  ExtendEventInput,
  StartEventInput,
} from "./operator-api/validation";

const activeEventFilter = (workspaceId: number) =>
  and(
    eq(events.workspaceId, workspaceId),
    eq(events.isActivePublicEvent, true),
    eq(events.status, "active"),
  );

export const activeEventSelection = {
  id: events.id,
  workspaceId: events.workspaceId,
  name: events.name,
  venue: events.venue,
  startsAt: events.startsAt,
  facebookUrl: events.facebookUrl,
  status: events.status,
  isActivePublicEvent: events.isActivePublicEvent,
  publicQueueEnabled: events.publicQueueEnabled,
  songRequestsEnabled: events.songRequestsEnabled,
  publicShowSongTitles: events.publicShowSongTitles,
  autoCloseAt: events.autoCloseAt,
  endsAt: events.endsAt,
  closedAt: events.closedAt,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
};

type DatabaseTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export async function getActiveEventAfterLazyClose(now = new Date()) {
  return getDb().transaction(async (transaction) => {
    const workspaceId = await requireDefaultWorkspaceIdInTransaction(
      transaction,
    );
    await closeExpiredActiveEventInTransaction(transaction, now, workspaceId);

    const [event] = await transaction
      .select(activeEventSelection)
      .from(events)
      .where(activeEventFilter(workspaceId))
      .limit(1);

    return event ?? null;
  });
}

export async function getActivePublicEventReadOnly(now = new Date()) {
  const [event] = await getDb()
    .select(activeEventSelection)
    .from(events)
    .innerJoin(workspaces, eq(workspaces.id, events.workspaceId))
    .where(
      and(
        eq(workspaces.handle, DEFAULT_WORKSPACE_HANDLE),
        eq(workspaces.active, true),
        eq(events.workspaceId, workspaces.id),
        eq(events.isActivePublicEvent, true),
        eq(events.status, "active"),
        lte(events.startsAt, now),
        or(isNull(events.autoCloseAt), gt(events.autoCloseAt, now)),
      ),
    )
    .limit(1);

  return event ?? null;
}

export async function closeExpiredActiveEventInTransaction(
  transaction: DatabaseTransaction,
  now = new Date(),
  workspaceId?: number,
) {
  const targetWorkspaceId =
    workspaceId ?? (await requireDefaultWorkspaceIdInTransaction(transaction));
  const [closedEvent] = await transaction
    .update(events)
    .set({
      status: "closed",
      isActivePublicEvent: false,
      closedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        activeEventFilter(targetWorkspaceId),
        isNotNull(events.autoCloseAt),
        lte(events.autoCloseAt, now),
      ),
    )
    .returning({
      id: events.id,
      autoCloseAt: events.autoCloseAt,
    });

  if (!closedEvent) {
    return null;
  }

  await transaction.insert(operatorAuditLog).values({
    actorKind: "system",
    operatorId: null,
    eventId: closedEvent.id,
    action: "auto_close_event",
    entityId: String(closedEvent.id),
    payload: {
      autoCloseAt: closedEvent.autoCloseAt?.toISOString() ?? null,
      closedAt: now.toISOString(),
    },
  });

  return closedEvent;
}

export async function updateActiveEventSettings(
  input: EventSettingsInput,
  operatorId: number,
) {
  return getDb().transaction(async (transaction) => {
    await acquireEventLifecycleLock(transaction);
    const now = new Date();
    const workspaceId = await requireDefaultWorkspaceIdInTransaction(
      transaction,
    );
    await closeExpiredActiveEventInTransaction(transaction, now, workspaceId);
    const event = await requireActiveEventForUpdate(
      transaction,
      workspaceId,
    );

    const [updatedEvent] = await transaction
      .update(events)
      .set({
        name: input.name,
        venue: input.venue,
        songRequestsEnabled: input.songRequestsEnabled,
        publicQueueEnabled: input.publicQueueEnabled,
        publicShowSongTitles: input.publicShowSongTitles,
        updatedAt: now,
      })
      .where(eq(events.id, event.id))
      .returning(activeEventSelection);

    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator",
      operatorId,
      eventId: event.id,
      action: "update_event_settings",
      entityId: String(event.id),
      payload: {
        previous: {
          name: event.name,
          venue: event.venue,
          songRequestsEnabled: event.songRequestsEnabled,
          publicQueueEnabled: event.publicQueueEnabled,
          publicShowSongTitles: event.publicShowSongTitles,
        },
        next: {
          name: input.name,
          venue: input.venue,
          songRequestsEnabled: input.songRequestsEnabled,
          publicQueueEnabled: input.publicQueueEnabled,
          publicShowSongTitles: input.publicShowSongTitles,
        },
      },
    });

    return updatedEvent;
  });
}

export async function extendActiveEvent(
  input: ExtendEventInput,
  operatorId: number,
) {
  return getDb().transaction(async (transaction) => {
    await acquireEventLifecycleLock(transaction);
    const now = new Date();
    const workspaceId = await requireDefaultWorkspaceIdInTransaction(
      transaction,
    );
    await closeExpiredActiveEventInTransaction(transaction, now, workspaceId);
    const event = await requireActiveEventForUpdate(
      transaction,
      workspaceId,
    );
    const base = event.autoCloseAt ?? now;
    const autoCloseAt = new Date(
      base.getTime() + input.hours * 60 * 60 * 1_000,
    );

    const [updatedEvent] = await transaction
      .update(events)
      .set({
        autoCloseAt,
        endsAt: autoCloseAt,
        updatedAt: now,
      })
      .where(eq(events.id, event.id))
      .returning(activeEventSelection);

    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator",
      operatorId,
      eventId: event.id,
      action: "extend_event",
      entityId: String(event.id),
      payload: {
        hours: input.hours,
        previousAutoCloseAt: event.autoCloseAt?.toISOString() ?? null,
        autoCloseAt: autoCloseAt.toISOString(),
      },
    });

    return updatedEvent;
  });
}

export async function closeActiveEvent(operatorId: number) {
  return getDb().transaction(async (transaction) => {
    await acquireEventLifecycleLock(transaction);
    const workspaceId = await requireDefaultWorkspaceIdInTransaction(
      transaction,
    );
    const event = await requireActiveEventForUpdate(
      transaction,
      workspaceId,
    );
    const now = new Date();

    const [closedEvent] = await transaction
      .update(events)
      .set({
        status: "closed",
        isActivePublicEvent: false,
        closedAt: now,
        updatedAt: now,
      })
      .where(eq(events.id, event.id))
      .returning(activeEventSelection);

    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator",
      operatorId,
      eventId: event.id,
      action: "close_event",
      entityId: String(event.id),
      payload: {
        closedAt: now.toISOString(),
      },
    });

    return closedEvent;
  });
}

export async function startEvent(
  input: StartEventInput,
  operatorId: number,
) {
  return getDb().transaction(async (transaction) => {
    await acquireEventLifecycleLock(transaction);
    const now = new Date();
    const workspaceId = await requireDefaultWorkspaceIdInTransaction(
      transaction,
    );
    await closeExpiredActiveEventInTransaction(transaction, now, workspaceId);

    const [activeEvent] = await transaction
      .select({ id: events.id })
      .from(events)
      .where(activeEventFilter(workspaceId))
      .limit(1);

    if (activeEvent) {
      throw new OperatorApiError(
        409,
        "ACTIVE_EVENT_ALREADY_EXISTS",
        "An active public event already exists.",
      );
    }

    const autoCloseAt = calculateAutoCloseAt(now);
    const [createdEvent] = await transaction
      .insert(events)
      .values({
        workspaceId,
        name: input.name,
        venue: input.venue,
        startsAt: now,
        autoCloseAt,
        endsAt: autoCloseAt,
        status: "active",
        isActivePublicEvent: true,
        songRequestsEnabled: false,
        publicQueueEnabled: false,
        publicShowSongTitles: true,
      })
      .returning(activeEventSelection);

    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator",
      operatorId,
      eventId: createdEvent.id,
      action: "start_event",
      entityId: String(createdEvent.id),
      payload: {
        startsAt: now.toISOString(),
        autoCloseAt: autoCloseAt.toISOString(),
      },
    });

    return createdEvent;
  });
}

async function requireActiveEventForUpdate(
  transaction: DatabaseTransaction,
  workspaceId: number,
) {
  const [event] = await transaction
    .select(activeEventSelection)
    .from(events)
    .where(activeEventFilter(workspaceId))
    .for("update")
    .limit(1);

  if (!event) {
    throw new OperatorApiError(
      404,
      "ACTIVE_EVENT_NOT_FOUND",
      "No active public event is available.",
    );
  }

  return event;
}

export async function requireDefaultWorkspaceIdInTransaction(
  transaction: DatabaseTransaction,
) {
  const [workspace] = await transaction
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.handle, DEFAULT_WORKSPACE_HANDLE),
        eq(workspaces.active, true),
      ),
    )
    .limit(1);

  if (!workspace) {
    throw new Error("Default workspace is not configured.");
  }

  return workspace.id;
}

async function acquireEventLifecycleLock(
  transaction: DatabaseTransaction,
) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext('poza_nuta_active_event'))`,
  );
}
