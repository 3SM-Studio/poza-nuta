import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import {
  eventAccessLinks,
  events,
  operatorAuditLog,
} from "../../db/schema";
import { getDb } from "../db";
import { closeExpiredActiveEventInTransaction } from "../event-lifecycle";
import {
  generateEventAccessCode,
  hashEventAccessCode,
} from "./crypto";
import { OperatorApiError } from "./errors";
import type { CreateEventAccessLinkInput } from "./validation";

const activeEventFilter = and(
  eq(events.isActivePublicEvent, true),
  eq(events.status, "active"),
);

const activeEventIdentitySelection = {
  id: events.id,
  name: events.name,
};

const eventAccessLinkMetadataSelection = {
  id: eventAccessLinks.id,
  eventId: eventAccessLinks.eventId,
  label: eventAccessLinks.label,
  active: eventAccessLinks.active,
  createdAt: eventAccessLinks.createdAt,
  revokedAt: eventAccessLinks.revokedAt,
  lastUsedAt: eventAccessLinks.lastUsedAt,
  useCount: eventAccessLinks.useCount,
  createdByOperatorId: eventAccessLinks.createdByOperatorId,
};

type DatabaseTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export async function listActiveEventAccessLinks() {
  return getDb().transaction(async (transaction) => {
    await closeExpiredActiveEventInTransaction(transaction);
    const event = await requireActiveEvent(transaction);
    const links = await transaction
      .select(eventAccessLinkMetadataSelection)
      .from(eventAccessLinks)
      .where(eq(eventAccessLinks.eventId, event.id))
      .orderBy(desc(eventAccessLinks.createdAt), desc(eventAccessLinks.id));

    return { event, links };
  });
}

export async function createActiveEventAccessLink(
  input: CreateEventAccessLinkInput,
  operatorId: number,
) {
  const code = generateEventAccessCode();
  const codeHash = hashEventAccessCode(code);

  return getDb().transaction(async (transaction) => {
    await closeExpiredActiveEventInTransaction(transaction);
    const event = await requireActiveEvent(transaction);
    const [link] = await transaction
      .insert(eventAccessLinks)
      .values({
        eventId: event.id,
        codeHash,
        label: input.label,
        createdByOperatorId: operatorId,
      })
      .returning(eventAccessLinkMetadataSelection);

    await transaction.insert(operatorAuditLog).values({
      operatorId,
      eventId: event.id,
      action: "create_event_access_link",
      entityId: String(link.id),
      payload: {
        label: link.label,
        active: link.active,
      },
    });

    return {
      event,
      link,
      code,
      sessionPath: `/session/${code}`,
    };
  });
}

export async function revokeActiveEventAccessLink(
  linkId: number,
  operatorId: number,
) {
  return getDb().transaction(async (transaction) => {
    await closeExpiredActiveEventInTransaction(transaction);
    const event = await requireActiveEvent(transaction);
    const [existingLink] = await transaction
      .select(eventAccessLinkMetadataSelection)
      .from(eventAccessLinks)
      .where(
        and(
          eq(eventAccessLinks.id, linkId),
          eq(eventAccessLinks.eventId, event.id),
        ),
      )
      .for("update")
      .limit(1);

    if (!existingLink) {
      throw new OperatorApiError(
        404,
        "EVENT_ACCESS_LINK_NOT_FOUND",
        "The access link does not belong to the active public event.",
      );
    }

    if (existingLink.revokedAt) {
      throw new OperatorApiError(
        409,
        "EVENT_ACCESS_LINK_ALREADY_REVOKED",
        "The access link has already been revoked.",
      );
    }

    const revokedAt = new Date();
    const [link] = await transaction
      .update(eventAccessLinks)
      .set({
        active: false,
        revokedAt,
      })
      .where(
        and(
          eq(eventAccessLinks.id, existingLink.id),
          eq(eventAccessLinks.eventId, event.id),
          isNull(eventAccessLinks.revokedAt),
        ),
      )
      .returning(eventAccessLinkMetadataSelection);

    if (!link) {
      throw new OperatorApiError(
        409,
        "EVENT_ACCESS_LINK_ALREADY_REVOKED",
        "The access link has already been revoked.",
      );
    }

    await transaction.insert(operatorAuditLog).values({
      operatorId,
      eventId: event.id,
      action: "revoke_event_access_link",
      entityId: String(link.id),
      payload: {
        label: link.label,
        revokedAt: link.revokedAt?.toISOString() ?? revokedAt.toISOString(),
      },
    });

    return { event, link };
  });
}

async function requireActiveEvent(transaction: DatabaseTransaction) {
  const [event] = await transaction
    .select(activeEventIdentitySelection)
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
