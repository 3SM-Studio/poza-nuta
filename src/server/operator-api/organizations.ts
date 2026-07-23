import "server-only";

import { cache } from "react";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";

import {
  eventSessionCodes,
  eventSessions,
  events,
  operatorAuditLog,
  operatorUsers,
  workspaceMembers,
  workspaces,
} from "../../db/schema";
import { getDb } from "../db";
import {
  generateOrganizationPublicId,
  isOrganizationPublicId,
} from "../../lib/organization-public-id";
import {
  buildOwnerWorkspaceMembershipInput,
  buildWorkspaceHandleFromName,
  validateOrganizationName,
} from "../../lib/organization-workspace";
import {
  canManageDashboardEventLifecycle,
  isActivePublicEventUniqueViolation,
  resolveDashboardEventCloseAt,
} from "../../lib/dashboard-event-lifecycle";
import {
  canReopenEvent,
  canResolveEventJoinCode,
  getEffectiveEventCloseInstant,
} from "../../lib/event-session-lifecycle";
import {
  buildEventSlugCandidate,
  buildEventSlugCollisionCandidate,
  isValidEventSlug,
} from "../../lib/event-slug";
import { isEventSlugUniqueViolation } from "../../lib/event-slug-db-error";
import { getEffectiveEventLifecycleStatus } from "../../lib/effective-event-lifecycle";
import { parseDashboardEventIdentifier } from "../../lib/dashboard-event-identifier";
import { withEventSessionIdentityRetry } from "../../lib/event-session-identity";
import { isEventSessionIdentityUniqueViolation } from "../../lib/event-session-identity-db-error";
import { withSessionCodeCollisionRetry } from "../../lib/session-code";
import { isSessionCodeUniqueViolation } from "../../lib/session-code-db-error";
import {
  insertEventSessionIdentity,
  lockEventSessionIdentity,
  publishEventSessionInvalidation,
} from "../event-session-identity-store";
import { OperatorApiError } from "./errors";
import type {
  CreateDashboardEventInput,
  ExtendDashboardEventInput,
  UpdateDashboardEventDetailsInput,
  UpdateDashboardEventAutoCloseAtInput,
} from "./validation";

export type DashboardOrganizationRole =
  | "owner"
  | "manager"
  | "operator"
  | "viewer";

export type DashboardOrganization = {
  id: number;
  publicId: string;
  name: string;
  handle: string;
  active: boolean;
  role: DashboardOrganizationRole;
};

export type DashboardOrganizationEvent = {
  id: number;
  publicId: string;
  name: string;
  slug: string | null;
  venue: string | null;
  city: string | null;
  sessionCode: string;
  startsAt: Date;
  facebookUrl: string | null;
  status: "draft" | "active" | "closed" | "cancelled";
  visibility: "private" | "public";
  publishedAt: Date | null;
  isActivePublicEvent: boolean;
  publicQueueEnabled: boolean;
  songRequestsEnabled: boolean;
  publicShowSongTitles: boolean;
  autoCloseAt: Date | null;
  endsAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DashboardOrganizationMember = {
  id: number;
  operatorUserId: number;
  operatorName: string;
  authUserId: string | null;
  role: DashboardOrganizationRole;
  active: boolean;
};

const organizationSelection = {
  id: workspaces.id,
  publicId: workspaces.publicId,
  name: workspaces.name,
  handle: workspaces.handle,
  active: workspaces.active,
  role: workspaceMembers.role,
};

const workspaceSelection = {
  id: workspaces.id,
  publicId: workspaces.publicId,
  name: workspaces.name,
  handle: workspaces.handle,
  active: workspaces.active,
};

const dashboardEventSelection = {
  id: events.id,
  publicId: events.publicId,
  name: events.name,
  slug: events.slug,
  venue: events.venue,
  city: events.city,
  sessionCode: events.sessionCode,
  startsAt: events.startsAt,
  facebookUrl: events.facebookUrl,
  status: events.status,
  visibility: events.visibility,
  publishedAt: events.publishedAt,
  isActivePublicEvent: events.isActivePublicEvent,
  publicQueueEnabled: events.publicQueueEnabled,
  songRequestsEnabled: events.songRequestsEnabled,
  publicShowSongTitles: events.publicShowSongTitles,
  autoCloseAt: events.autoCloseAt,
  endsAt: events.endsAt,
  closedAt: events.closedAt,
  closeReason: events.closeReason,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
};

const ownerOrganizationSelection = {
  id: workspaces.id,
  publicId: workspaces.publicId,
  name: workspaces.name,
  handle: workspaces.handle,
  active: workspaces.active,
  role: workspaceMembers.role,
};

export const listDashboardOrganizationsForAuthUser = cache(
  async (authUserId: string) => {
    return getDb()
      .select(organizationSelection)
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
          eq(operatorUsers.authUserId, authUserId),
          eq(operatorUsers.active, true),
          eq(workspaceMembers.active, true),
          eq(workspaces.active, true),
        ),
      )
      .orderBy(workspaces.name, workspaces.publicId);
  },
);

export async function getDashboardOrganizationForAuthUser(
  authUserId: string,
  organizationId: string,
) {
  if (!isOrganizationPublicId(organizationId)) {
    return null;
  }

  const [organization] = await getDb()
    .select(organizationSelection)
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

  return organization ?? null;
}

export async function listDashboardOrganizationEventsForAuthUser(
  authUserId: string,
  organizationId: string,
) {
  const organization = await getDashboardOrganizationForAuthUser(
    authUserId,
    organizationId,
  );

  if (!organization) {
    return null;
  }

  const organizationEvents = await getDb()
    .select({
      ...dashboardEventSelection,
    })
    .from(events)
    .where(eq(events.workspaceId, organization.id))
    .orderBy(desc(events.startsAt), desc(events.id));

  return {
    organization,
    events: organizationEvents.map((event) => ({
      ...event,
      effectiveStatus: getEffectiveEventLifecycleStatus(event),
    })),
  };
}

export function canCreateDashboardOrganizationEvent(
  role: DashboardOrganizationRole,
) {
  return role === "owner" || role === "manager";
}

export function canManageDashboardOrganizationEvent(
  role: DashboardOrganizationRole,
) {
  return role === "owner" || role === "manager";
}

export function canShareDashboardOrganizationEvent(
  role: DashboardOrganizationRole,
) {
  return role === "owner" || role === "manager" || role === "operator";
}

export async function getDashboardOrganizationEventForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: string | number;
}) {
  const organization = await getDashboardOrganizationForAuthUser(
    input.authUserId,
    input.organizationId,
  );

  if (!organization) {
    return null;
  }

  const [event] = await getDb()
    .select(dashboardEventSelection)
    .from(events)
    .where(
      and(
        eq(events.workspaceId, organization.id),
        getEventIdentifierCondition(input.eventId),
      ),
    )
    .limit(1);

  if (!event) {
    return null;
  }

  return {
    organization,
    event: {
      ...event,
      effectiveStatus: getEffectiveEventLifecycleStatus(event),
    },
  };
}

export async function getDashboardOrganizationEventSessionAccessForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: string | number;
}) {
  const result = await getDashboardOrganizationEventForAuthUser(input);

  if (!result) {
    return null;
  }

  const [identity] = await getDb()
    .select({ publicToken: eventSessions.publicToken })
    .from(eventSessions)
    .where(eq(eventSessions.eventId, result.event.id))
    .limit(1);

  if (!identity) return null;

  return {
    ...result,
    event: {
      ...result.event,
      publicToken: identity.publicToken,
    },
  };
}

export async function createDashboardOrganizationEventForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  event: CreateDashboardEventInput;
}) {
  return mapActivePublicEventUniqueViolation(() =>
    withEventSessionIdentityRetry(
      (identity) =>
        withSessionCodeCollisionRetry(
          (sessionCode) =>
            getDb().transaction(async (transaction) => {
        const organization =
          await requireEventCreatorOrganizationInTransaction(
            transaction,
            input.authUserId,
            input.organizationId,
          );
        const now = new Date();

    await assertNoActivePublicEventConflictInTransaction(transaction, {
      workspaceId: organization.id,
      nextIsActivePublicEvent: input.event.isActivePublicEvent,
    });

    const [createdEvent] = await transaction
      .insert(events)
      .values({
        workspaceId: organization.id,
        publicId: identity.eventPublicId,
        name: input.event.title,
        venue: input.event.venue,
        city: input.event.city,
        sessionCode,
        startsAt: input.event.startsAt,
        autoCloseAt: input.event.autoCloseAt,
        endsAt: input.event.autoCloseAt,
        facebookUrl: input.event.facebookUrl,
        status: input.event.isActivePublicEvent ? "active" : "draft",
        isActivePublicEvent: input.event.isActivePublicEvent,
        songRequestsEnabled: input.event.songRequestsEnabled,
        publicQueueEnabled: input.event.publicQueueEnabled,
        publicShowSongTitles: input.event.publicShowSongTitles,
        updatedAt: now,
      })
      .returning(dashboardEventSelection);

    if (!createdEvent) {
      throw new Error("Event could not be created.");
    }

    const catalogFields = await resolveDashboardEventCatalogFieldsInTransaction(
      transaction,
      createdEvent,
      input.event,
      now,
    );

    const [event] = await mapEventSlugUniqueViolation(async () =>
      transaction
        .update(events)
        .set({
          ...catalogFields,
          updatedAt: now,
        })
        .where(
          and(
            eq(events.workspaceId, organization.id),
            eq(events.id, createdEvent.id),
          ),
        )
        .returning(dashboardEventSelection),
    );

    if (!event) {
      throw new Error("Event catalog metadata could not be created.");
    }

    await insertEventSessionIdentity(transaction, {
      eventId: event.id,
      publicToken: identity.publicToken,
      sessionCode,
      createdByOperatorId: organization.operatorId,
      createdAt: event.createdAt,
    });

    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator",
      operatorId: organization.operatorId,
      eventId: event.id,
      action: "create_event",
      entityId: String(event.id),
      payload: {
        startsAt: input.event.startsAt.toISOString(),
        autoCloseAt: input.event.autoCloseAt.toISOString(),
        endsAt: input.event.autoCloseAt.toISOString(),
        songRequestsEnabled: input.event.songRequestsEnabled,
        publicQueueEnabled: input.event.publicQueueEnabled,
        publicShowSongTitles: input.event.publicShowSongTitles,
        isActivePublicEvent: input.event.isActivePublicEvent,
        visibility: event.visibility,
        slug: event.slug,
        facebookUrlProvided: Boolean(input.event.facebookUrl),
      },
    });

            return {
              organization,
              event,
            };
            }),
          isSessionCodeUniqueViolation,
        ),
      isEventSessionIdentityUniqueViolation,
    ),
  );
}

export async function updateDashboardOrganizationEventAutoCloseAtForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: string | number;
  event: UpdateDashboardEventAutoCloseAtInput;
}) {
  return getDb().transaction(async (transaction) => {
    const { organization, event } =
      await requireEventManagerOrganizationEventInTransaction(
        transaction,
        input.authUserId,
        input.organizationId,
        input.eventId,
      );
    const now = new Date();

    assertDashboardEventCanBeManaged(event, now);

    if (input.event.autoCloseAt.getTime() <= event.startsAt.getTime()) {
      throw new OperatorApiError(
        400,
        "EVENT_AUTO_CLOSE_BEFORE_START",
        "Event close time must be after the start time.",
      );
    }

    const [updatedEvent] = await transaction
      .update(events)
      .set({
        autoCloseAt: input.event.autoCloseAt,
        endsAt: input.event.autoCloseAt,
        updatedAt: now,
      })
      .where(and(eq(events.workspaceId, organization.id), eq(events.id, event.id)))
      .returning(dashboardEventSelection);

    if (!updatedEvent) {
      throw new OperatorApiError(
        404,
        "EVENT_NOT_FOUND",
        "Event was not found.",
      );
    }

    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator",
      operatorId: organization.operatorId,
      eventId: event.id,
      action: "update_event_auto_close_at",
      entityId: String(event.id),
      payload: {
        previousAutoCloseAt: event.autoCloseAt?.toISOString() ?? null,
        autoCloseAt: input.event.autoCloseAt.toISOString(),
      },
    });

    await publishEventSessionInvalidation(transaction, event.id);

    return {
      organization,
      event: updatedEvent,
    };
  });
}

export async function updateDashboardOrganizationEventDetailsForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: string | number;
  event: UpdateDashboardEventDetailsInput;
}) {
  return mapActivePublicEventUniqueViolation(() =>
    getDb().transaction(async (transaction) => {
      const { organization, event } =
        await requireEventManagerOrganizationEventInTransaction(
          transaction,
          input.authUserId,
          input.organizationId,
          input.eventId,
        );
    const now = new Date();

    assertDashboardEventCanBeManaged(event, now);

    if (input.event.autoCloseAt.getTime() <= input.event.startsAt.getTime()) {
      throw new OperatorApiError(
        400,
        "EVENT_AUTO_CLOSE_BEFORE_START",
        "Event close time must be after the start time.",
      );
    }

    await assertNoActivePublicEventConflictInTransaction(transaction, {
      workspaceId: organization.id,
      nextIsActivePublicEvent: input.event.isActivePublicEvent,
      eventId: event.id,
    });

    const catalogFields = await resolveDashboardEventCatalogFieldsInTransaction(
      transaction,
      event,
      input.event,
      now,
    );

    const [updatedEvent] = await mapEventSlugUniqueViolation(async () =>
      transaction
        .update(events)
        .set({
          name: input.event.title,
          venue: input.event.venue,
          city: input.event.city,
          slug: catalogFields.slug,
          visibility: catalogFields.visibility,
          publishedAt: catalogFields.publishedAt,
          startsAt: input.event.startsAt,
          autoCloseAt: input.event.autoCloseAt,
          endsAt: input.event.autoCloseAt,
          facebookUrl: input.event.facebookUrl,
          status: input.event.isActivePublicEvent ? "active" : event.status,
          isActivePublicEvent: input.event.isActivePublicEvent,
          songRequestsEnabled: input.event.songRequestsEnabled,
          publicQueueEnabled: input.event.publicQueueEnabled,
          publicShowSongTitles: input.event.publicShowSongTitles,
          updatedAt: now,
        })
        .where(
          and(eq(events.workspaceId, organization.id), eq(events.id, event.id)),
        )
        .returning(dashboardEventSelection),
    );

    if (!updatedEvent) {
      throw new OperatorApiError(
        404,
        "EVENT_NOT_FOUND",
        "Event was not found.",
      );
    }

    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator",
      operatorId: organization.operatorId,
      eventId: event.id,
      action: "update_dashboard_event_details",
      entityId: String(event.id),
      payload: {
        previous: {
          startsAt: event.startsAt.toISOString(),
          autoCloseAt: event.autoCloseAt?.toISOString() ?? null,
          endsAt: event.endsAt.toISOString(),
          songRequestsEnabled: event.songRequestsEnabled,
          publicQueueEnabled: event.publicQueueEnabled,
          publicShowSongTitles: event.publicShowSongTitles,
          isActivePublicEvent: event.isActivePublicEvent,
          visibility: event.visibility,
          slug: event.slug,
          facebookUrlProvided: Boolean(event.facebookUrl),
        },
        next: {
          startsAt: input.event.startsAt.toISOString(),
          autoCloseAt: input.event.autoCloseAt.toISOString(),
          endsAt: input.event.autoCloseAt.toISOString(),
          songRequestsEnabled: input.event.songRequestsEnabled,
          publicQueueEnabled: input.event.publicQueueEnabled,
          publicShowSongTitles: input.event.publicShowSongTitles,
          isActivePublicEvent: input.event.isActivePublicEvent,
          visibility: updatedEvent.visibility,
          slug: updatedEvent.slug,
          facebookUrlProvided: Boolean(input.event.facebookUrl),
        },
      },
    });

    await publishEventSessionInvalidation(transaction, event.id);

      return {
        organization,
        event: updatedEvent,
      };
    }),
  );
}

export async function extendDashboardOrganizationEventForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: string | number;
  extension: ExtendDashboardEventInput;
}) {
  return getDb().transaction(async (transaction) => {
    const { organization, event } =
      await requireEventManagerOrganizationEventInTransaction(
        transaction,
        input.authUserId,
        input.organizationId,
        input.eventId,
      );
    const now = new Date();

    assertDashboardEventCanBeManaged(event, now);

    const autoCloseAt = resolveDashboardEventCloseAt({
      autoCloseAt: event.autoCloseAt,
      minutes: input.extension.minutes,
      closesAt: input.extension.closesAt,
      now,
    });

    if (
      autoCloseAt.getTime() <= event.startsAt.getTime() ||
      autoCloseAt.getTime() <= now.getTime()
    ) {
      throw new OperatorApiError(
        400,
        "EVENT_AUTO_CLOSE_BEFORE_START",
        "Event close time must be after the start time.",
      );
    }

    const [updatedEvent] = await transaction
      .update(events)
      .set({
        autoCloseAt,
        endsAt: autoCloseAt,
        updatedAt: now,
      })
      .where(and(eq(events.workspaceId, organization.id), eq(events.id, event.id)))
      .returning(dashboardEventSelection);

    if (!updatedEvent) {
      throw new OperatorApiError(
        404,
        "EVENT_NOT_FOUND",
        "Event was not found.",
      );
    }

    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator",
      operatorId: organization.operatorId,
      eventId: event.id,
      action: "event.extend",
      entityId: String(event.id),
      payload: {
        schemaVersion: 1,
        targetType: "event",
        outcome: "success",
        operation: "extend",
        reason:
          input.extension.closesAt === null
            ? "duration_extension"
            : "custom_close_time",
        minutes: input.extension.minutes,
        customCloseAt: input.extension.closesAt !== null,
        previousCloseAt: (
          event.autoCloseAt ?? event.endsAt
        ).toISOString(),
        newCloseAt: autoCloseAt.toISOString(),
      },
    });

    await publishEventSessionInvalidation(transaction, event.id);

    return {
      organization,
      event: updatedEvent,
    };
  });
}

export async function closeDashboardOrganizationEventForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: string | number;
}) {
  return getDb().transaction(async (transaction) => {
    const { organization, event } =
      await requireEventManagerOrganizationEventInTransaction(
        transaction,
        input.authUserId,
        input.organizationId,
        input.eventId,
      );
    const now = new Date();

    assertDashboardEventCanBeManaged(event, now);

    const [closedEvent] = await transaction
      .update(events)
      .set({
        status: "closed",
        isActivePublicEvent: false,
        closedAt: now,
        closeReason: "manual",
        updatedAt: now,
      })
      .where(and(eq(events.workspaceId, organization.id), eq(events.id, event.id)))
      .returning(dashboardEventSelection);

    if (!closedEvent) {
      throw new OperatorApiError(
        404,
        "EVENT_NOT_FOUND",
        "Event was not found.",
      );
    }

    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator",
      operatorId: organization.operatorId,
      eventId: event.id,
      action: "close_dashboard_event",
      entityId: String(event.id),
      payload: {
        previousStatus: event.status,
        previousAutoCloseAt: event.autoCloseAt?.toISOString() ?? null,
        closedAt: now.toISOString(),
      },
    });

    await publishEventSessionInvalidation(transaction, event.id);

    return {
      organization,
      event: closedEvent,
    };
  });
}

export async function reopenDashboardOrganizationEventForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: string | number;
  extension: ExtendDashboardEventInput;
}) {
  return mapActivePublicEventUniqueViolation(() =>
    getDb().transaction(async (transaction) => {
      const { organization, event } =
        await requireEventManagerOrganizationEventInTransaction(
          transaction,
          input.authUserId,
          input.organizationId,
          input.eventId,
        );
    const now = new Date();

    if (!canReopenEvent(event, now)) {
      throw new OperatorApiError(
        409,
        "EVENT_REOPEN_WINDOW_EXPIRED",
        "The event can no longer be reopened.",
      );
    }

    const autoCloseAt = resolveDashboardEventCloseAt({
      autoCloseAt: null,
      minutes: input.extension.minutes,
      closesAt: input.extension.closesAt,
      now,
    });

    if (autoCloseAt.getTime() <= now.getTime()) {
      throw new OperatorApiError(
        400,
        "EVENT_CLOSE_TIME_INVALID",
        "The new event close time must be in the future.",
      );
    }

    await assertNoActivePublicEventConflictInTransaction(transaction, {
      workspaceId: organization.id,
      nextIsActivePublicEvent: true,
      eventId: event.id,
    });

    const [reopenedEvent] = await transaction
      .update(events)
      .set({
        status: "active",
        isActivePublicEvent: true,
        autoCloseAt,
        endsAt: autoCloseAt,
        closedAt: null,
        closeReason: null,
        updatedAt: now,
      })
      .where(and(eq(events.workspaceId, organization.id), eq(events.id, event.id)))
      .returning(dashboardEventSelection);

    if (!reopenedEvent) {
      throw new OperatorApiError(404, "EVENT_NOT_FOUND", "Event was not found.");
    }

    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator",
      operatorId: organization.operatorId,
      eventId: event.id,
      action: "event.reopen",
      entityId: String(event.id),
      payload: {
        schemaVersion: 1,
        targetType: "event",
        outcome: "success",
        operation: "reopen",
        reason: "operator_requested",
        previousCloseAt:
          getEffectiveEventCloseInstant(event)?.toISOString() ?? null,
        newCloseAt: autoCloseAt.toISOString(),
        previousCloseReason: event.closeReason,
        minutes: input.extension.minutes,
        customCloseAt: input.extension.closesAt !== null,
      },
    });

    await publishEventSessionInvalidation(transaction, event.id);

      return { organization, event: reopenedEvent };
    }),
  );
}

export async function rotateDashboardOrganizationEventSessionCodeForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: string | number;
  expectedSessionCode: string;
}) {
  return withSessionCodeCollisionRetry(
    (sessionCode) =>
      getDb().transaction(async (transaction) => {
        const { organization, event } =
          await requireEventManagerOrganizationEventInTransaction(
            transaction,
            input.authUserId,
            input.organizationId,
            input.eventId,
          );
        const now = new Date();

        if (!canResolveEventJoinCode(event, now)) {
          throw new OperatorApiError(
            409,
            "EVENT_SESSION_CODE_FINALIZED",
            "The event join code can no longer be rotated.",
          );
        }

        const identity = await lockEventSessionIdentity(transaction, event.id);
        if (!identity) {
          throw new OperatorApiError(
            409,
            "EVENT_SESSION_IDENTITY_MISSING",
            "The event session identity is unavailable.",
          );
        }

        if (identity.sessionCode !== input.expectedSessionCode) {
          throw new OperatorApiError(
            409,
            "EVENT_SESSION_CODE_STALE",
            "The event join code changed. Refresh and try again.",
          );
        }

        await transaction
          .update(eventSessionCodes)
          .set({
            validUntil: now,
            revokedAt: now,
            releaseAfter: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000),
            revokedByOperatorId: organization.operatorId,
          })
          .where(eq(eventSessionCodes.id, identity.codeId));

        await transaction.insert(eventSessionCodes).values({
          sessionId: identity.sessionId,
          code: sessionCode,
          validFrom: now,
          createdByOperatorId: organization.operatorId,
          rotationReason: "operator_rotation",
          createdAt: now,
        });

        const [updatedEvent] = await transaction
          .update(events)
          .set({ sessionCode, updatedAt: now })
          .where(and(eq(events.workspaceId, organization.id), eq(events.id, event.id)))
          .returning(dashboardEventSelection);

        if (!updatedEvent) {
          throw new OperatorApiError(404, "EVENT_NOT_FOUND", "Event was not found.");
        }

        await transaction.insert(operatorAuditLog).values({
          actorKind: "operator",
          operatorId: organization.operatorId,
          eventId: event.id,
          action: "event.session_code.rotate",
          entityId: String(event.id),
          payload: {
            schemaVersion: 1,
            targetType: "event",
            outcome: "success",
            operation: "session_code_rotation",
            reason: "operator_requested",
          },
        });

        await publishEventSessionInvalidation(
          transaction,
          event.id,
          identity.publicToken,
        );

        return {
          organization,
          event: { ...updatedEvent, publicToken: identity.publicToken },
        };
      }),
    isSessionCodeUniqueViolation,
  );
}

export async function listDashboardOrganizationMembersForAuthUser(
  authUserId: string,
  organizationId: string,
) {
  const organization = await getDashboardOrganizationForAuthUser(
    authUserId,
    organizationId,
  );

  if (!organization) {
    return null;
  }

  const members = await getDb()
    .select({
      id: workspaceMembers.id,
      operatorUserId: operatorUsers.id,
      operatorName: sql<string>`coalesce(${operatorUsers.displayName}, ${operatorUsers.name})`,
      authUserId: operatorUsers.authUserId,
      role: workspaceMembers.role,
      active: workspaceMembers.active,
    })
    .from(workspaceMembers)
    .innerJoin(operatorUsers, eq(operatorUsers.id, workspaceMembers.operatorUserId))
    .where(eq(workspaceMembers.workspaceId, organization.id))
    .orderBy(workspaceMembers.active, workspaceMembers.role, operatorUsers.name);

  return {
    organization,
    members,
  };
}

export async function updateDashboardOrganizationNameForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  name: string;
}) {
  const validation = validateOrganizationName(input.name);

  if (!validation.success) {
    throw new Error(validation.message);
  }

  return getDb().transaction(async (transaction) => {
    const organization = await requireOwnerOrganizationInTransaction(
      transaction,
      input.authUserId,
      input.organizationId,
    );

    const [updatedOrganization] = await transaction
      .update(workspaces)
      .set({
        name: validation.name,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, organization.id))
      .returning(workspaceSelection);

    if (!updatedOrganization) {
      throw new Error("Organization name could not be updated.");
    }

    return {
      ...updatedOrganization,
      role: "owner" as const,
    };
  });
}

export async function archiveDashboardOrganizationForAuthUser(input: {
  authUserId: string;
  organizationId: string;
}) {
  return getDb().transaction(async (transaction) => {
    const organization = await requireOwnerOrganizationInTransaction(
      transaction,
      input.authUserId,
      input.organizationId,
    );

    const [archivedOrganization] = await transaction
      .update(workspaces)
      .set({
        active: false,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, organization.id))
      .returning(workspaceSelection);

    if (!archivedOrganization) {
      throw new Error("Organization could not be archived.");
    }

    return {
      ...archivedOrganization,
      role: "owner" as const,
    };
  });
}

export async function createDashboardOrganizationForOperator(input: {
  name: string;
  operatorId: number;
}) {
  const validation = validateOrganizationName(input.name);

  if (!validation.success) {
    throw new Error(validation.message);
  }

  return getDb().transaction(async (transaction) => {
    const publicId = await generateUniqueOrganizationPublicId(async (candidate) => {
      const [existingWorkspace] = await transaction
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.publicId, candidate))
        .limit(1);

      return Boolean(existingWorkspace);
    });
    const handle = await generateUniqueWorkspaceHandle(
      validation.name,
      async (candidate) => {
        const [existingWorkspace] = await transaction
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.handle, candidate))
          .limit(1);

        return Boolean(existingWorkspace);
      },
    );

    const [workspace] = await transaction
      .insert(workspaces)
      .values({
        publicId,
        name: validation.name,
        handle,
        active: true,
      })
      .returning(workspaceSelection);

    if (!workspace) {
      throw new Error("Organization could not be created.");
    }

    await transaction.insert(workspaceMembers).values(
      buildOwnerWorkspaceMembershipInput({
        workspaceId: workspace.id,
        operatorUserId: input.operatorId,
      }),
    );

    return {
      ...workspace,
      role: "owner" as const,
    };
  });
}

async function generateUniqueOrganizationPublicId(
  exists: (candidate: string) => Promise<boolean>,
) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = generateOrganizationPublicId();

    if (!(await exists(candidate))) {
      return candidate;
    }
  }

  throw new Error("Could not generate a unique organization public ID.");
}

async function generateUniqueWorkspaceHandle(
  name: string,
  exists: (candidate: string) => Promise<boolean>,
) {
  const baseHandle = buildWorkspaceHandleFromName(name);

  if (!(await exists(baseHandle))) {
    return baseHandle;
  }

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${baseHandle}-${suffix}`;

    if (!(await exists(candidate))) {
      return candidate;
    }
  }

  throw new Error("Could not generate a unique workspace handle.");
}

type DatabaseTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

type DashboardEventCatalogInput = Pick<
  CreateDashboardEventInput | UpdateDashboardEventDetailsInput,
  "city" | "slug" | "title" | "visibility"
>;

async function resolveDashboardEventCatalogFieldsInTransaction(
  transaction: DatabaseTransaction,
  event: DashboardOrganizationEvent,
  input: DashboardEventCatalogInput,
  now: Date,
) {
  const baseSlug = buildEventSlugCandidate({
    requestedSlug: input.slug,
    name: input.title,
  });
  const slug = baseSlug
    ? await resolveUniqueEventSlugInTransaction(transaction, event.id, baseSlug)
    : null;

  if (input.visibility === "public") {
    if (!slug || !isValidEventSlug(slug)) {
      throw new OperatorApiError(
        400,
        "EVENT_PUBLICATION_SLUG_REQUIRED",
        "A public event requires a valid slug.",
      );
    }

    return {
      city: input.city,
      slug,
      visibility: "public" as const,
      publishedAt: event.publishedAt ?? now,
    };
  }

  return {
    city: input.city,
    slug,
    visibility: "private" as const,
    publishedAt: event.publishedAt,
  };
}

async function resolveUniqueEventSlugInTransaction(
  transaction: DatabaseTransaction,
  eventId: number,
  baseSlug: string,
) {
  if (!isValidEventSlug(baseSlug)) {
    throw new OperatorApiError(
      400,
      "EVENT_SLUG_INVALID",
      "Event slug is invalid.",
    );
  }

  if (!(await eventSlugExistsInTransaction(transaction, eventId, baseSlug))) {
    return baseSlug;
  }

  const collisionSlug = buildEventSlugCollisionCandidate({
    baseSlug,
    eventId,
  });

  if (
    !isValidEventSlug(collisionSlug) ||
    (await eventSlugExistsInTransaction(transaction, eventId, collisionSlug))
  ) {
    throw new OperatorApiError(
      409,
      "EVENT_SLUG_ALREADY_EXISTS",
      "Event slug is already used by another event.",
    );
  }

  return collisionSlug;
}

async function eventSlugExistsInTransaction(
  transaction: DatabaseTransaction,
  eventId: number,
  slug: string,
) {
  const [eventWithSlug] = await transaction
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.slug, slug), ne(events.id, eventId)))
    .limit(1);

  return Boolean(eventWithSlug);
}

async function mapEventSlugUniqueViolation<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (isEventSlugUniqueViolation(error)) {
      throw new OperatorApiError(
        409,
        "EVENT_SLUG_ALREADY_EXISTS",
        "Event slug is already used by another event.",
      );
    }

    throw error;
  }
}

async function mapActivePublicEventUniqueViolation<T>(
  action: () => Promise<T>,
) {
  try {
    return await action();
  } catch (error) {
    if (isActivePublicEventUniqueViolation(error)) {
      throw new OperatorApiError(
        409,
        "ACTIVE_PUBLIC_EVENT_ALREADY_EXISTS",
        "Another public event is already active for this organization.",
      );
    }

    throw error;
  }
}

async function requireOwnerOrganizationInTransaction(
  transaction: DatabaseTransaction,
  authUserId: string,
  organizationId: string,
) {
  if (!isOrganizationPublicId(organizationId)) {
    throw new Error("Organization was not found.");
  }

  const [organization] = await transaction
    .select(ownerOrganizationSelection)
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
        eq(workspaceMembers.role, "owner"),
      ),
    )
    .limit(1);

  if (!organization) {
    throw new Error("Only an active organization owner can perform this action.");
  }

  return organization;
}

async function requireEventCreatorOrganizationInTransaction(
  transaction: DatabaseTransaction,
  authUserId: string,
  organizationId: string,
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
      name: workspaces.name,
      handle: workspaces.handle,
      active: workspaces.active,
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
        or(eq(workspaceMembers.role, "owner"), eq(workspaceMembers.role, "manager")),
      ),
    )
    .limit(1);

  if (!organization) {
    throw new OperatorApiError(
      403,
      "WORKSPACE_EVENT_CREATE_FORBIDDEN",
      "Only an owner or manager can create events.",
    );
  }

  return organization;
}

async function requireEventManagerOrganizationEventInTransaction(
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
      name: workspaces.name,
      handle: workspaces.handle,
      active: workspaces.active,
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
        or(
          eq(workspaceMembers.role, "owner"),
          eq(workspaceMembers.role, "manager"),
        ),
      ),
    )
    .limit(1);

  if (!organization) {
    throw new OperatorApiError(
      403,
      "WORKSPACE_EVENT_MANAGE_FORBIDDEN",
      "Only an owner or manager can manage events.",
    );
  }

  const [event] = await transaction
    .select(dashboardEventSelection)
    .from(events)
    .where(
      and(
        eq(events.workspaceId, organization.id),
        getEventIdentifierCondition(eventId),
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

function assertDashboardEventCanBeManaged(
  event: DashboardOrganizationEvent,
  now: Date,
) {
  if (canManageDashboardEventLifecycle(event, now)) {
    return;
  }

  throw new OperatorApiError(
    409,
    "EVENT_MANAGEMENT_LOCKED",
    "Closed or cancelled events cannot be managed in this MVP.",
  );
}

async function assertNoActivePublicEventConflictInTransaction(
  transaction: DatabaseTransaction,
  input: {
    workspaceId: number;
    nextIsActivePublicEvent: boolean;
    eventId?: number;
  },
) {
  if (!input.nextIsActivePublicEvent) {
    return;
  }

  const filters = [
    eq(events.workspaceId, input.workspaceId),
    eq(events.isActivePublicEvent, true),
  ];

  if (input.eventId !== undefined) {
    filters.push(ne(events.id, input.eventId));
  }

  const [activePublicEvent] = await transaction
    .select({ id: events.id })
    .from(events)
    .where(and(...filters))
    .limit(1);

  if (!activePublicEvent) {
    return;
  }

  throw new OperatorApiError(
    409,
    "ACTIVE_PUBLIC_EVENT_ALREADY_EXISTS",
    "Another public event is already active for this organization.",
  );
}
