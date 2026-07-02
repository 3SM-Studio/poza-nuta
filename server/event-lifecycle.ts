import "server-only";

import { and, eq, isNotNull, lte, sql } from "drizzle-orm";

import { events, operatorAuditLog } from "../db/schema";
import { calculateAutoCloseAt } from "../lib/event-lifecycle";
import { getDb } from "./db";
import { OperatorApiError } from "./operator-api/errors";
import type {
  EventSettingsInput,
  ExtendEventInput,
  StartEventInput,
} from "./operator-api/validation";

const activeEventFilter = and(
  eq(events.isActivePublicEvent, true),
  eq(events.status, "active"),
);

export const activeEventSelection = {
  id: events.id,
  name: events.name,
  venue: events.venue,
  startsAt: events.startsAt,
  status: events.status,
  isActivePublicEvent: events.isActivePublicEvent,
  publicQueueEnabled: events.publicQueueEnabled,
  publicShowSongTitles: events.publicShowSongTitles,
  autoCloseAt: events.autoCloseAt,
  closedAt: events.closedAt,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
};

type DatabaseTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export async function getActiveEventAfterLazyClose(now = new Date()) {
  return getDb().transaction(async (transaction) => {
    await closeExpiredActiveEventInTransaction(transaction, now);

    const [event] = await transaction
      .select(activeEventSelection)
      .from(events)
      .where(activeEventFilter)
      .limit(1);

    return event ?? null;
  });
}

export async function closeExpiredActiveEventInTransaction(
  transaction: DatabaseTransaction,
  now = new Date(),
) {
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
        activeEventFilter,
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
    await closeExpiredActiveEventInTransaction(transaction, now);
    const event = await requireActiveEventForUpdate(transaction);

    const [updatedEvent] = await transaction
      .update(events)
      .set({
        name: input.name,
        venue: input.venue,
        publicQueueEnabled: input.publicQueueEnabled,
        publicShowSongTitles: input.publicShowSongTitles,
        updatedAt: now,
      })
      .where(eq(events.id, event.id))
      .returning(activeEventSelection);

    await transaction.insert(operatorAuditLog).values({
      operatorId,
      eventId: event.id,
      action: "update_event_settings",
      entityId: String(event.id),
      payload: {
        previous: {
          name: event.name,
          venue: event.venue,
          publicQueueEnabled: event.publicQueueEnabled,
          publicShowSongTitles: event.publicShowSongTitles,
        },
        next: {
          name: input.name,
          venue: input.venue,
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
    await closeExpiredActiveEventInTransaction(transaction, now);
    const event = await requireActiveEventForUpdate(transaction);
    const base = event.autoCloseAt ?? now;
    const autoCloseAt = new Date(
      base.getTime() + input.hours * 60 * 60 * 1_000,
    );

    const [updatedEvent] = await transaction
      .update(events)
      .set({
        autoCloseAt,
        updatedAt: now,
      })
      .where(eq(events.id, event.id))
      .returning(activeEventSelection);

    await transaction.insert(operatorAuditLog).values({
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
    const event = await requireActiveEventForUpdate(transaction);
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
    await closeExpiredActiveEventInTransaction(transaction, now);

    const [activeEvent] = await transaction
      .select({ id: events.id })
      .from(events)
      .where(activeEventFilter)
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
        name: input.name,
        venue: input.venue,
        startsAt: now,
        autoCloseAt,
        status: "active",
        isActivePublicEvent: true,
        publicQueueEnabled: false,
        publicShowSongTitles: true,
      })
      .returning(activeEventSelection);

    await transaction.insert(operatorAuditLog).values({
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
) {
  const [event] = await transaction
    .select(activeEventSelection)
    .from(events)
    .where(activeEventFilter)
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

async function acquireEventLifecycleLock(
  transaction: DatabaseTransaction,
) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext('poza_nuta_active_event'))`,
  );
}
