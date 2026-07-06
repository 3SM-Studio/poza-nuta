import "server-only";

import { cache } from "react";
import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";

import {
  eventAccessLinks,
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
  calculateDashboardEventExtendedAutoCloseAt,
  canManageDashboardEventLifecycle,
} from "../../lib/dashboard-event-lifecycle";
import {
  generateEventAccessCode,
  hashEventAccessCode,
} from "./crypto";
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
  name: string;
  venue: string | null;
  startsAt: Date;
  facebookUrl: string | null;
  status: "draft" | "active" | "closed";
  isActivePublicEvent: boolean;
  publicQueueEnabled: boolean;
  publicShowSongTitles: boolean;
  autoCloseAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DashboardOrganizationEventSessionLink = {
  id: number;
  eventId: number;
  label: string | null;
  active: boolean;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  useCount: number;
  createdByOperatorId: number | null;
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
  name: events.name,
  venue: events.venue,
  startsAt: events.startsAt,
  facebookUrl: events.facebookUrl,
  status: events.status,
  isActivePublicEvent: events.isActivePublicEvent,
  publicQueueEnabled: events.publicQueueEnabled,
  publicShowSongTitles: events.publicShowSongTitles,
  autoCloseAt: events.autoCloseAt,
  closedAt: events.closedAt,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
};

const dashboardEventSessionLinkSelection = {
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
    events: organizationEvents,
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
  eventId: number;
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
    .where(and(eq(events.workspaceId, organization.id), eq(events.id, input.eventId)))
    .limit(1);

  if (!event) {
    return null;
  }

  return {
    organization,
    event,
  };
}

export async function getDashboardOrganizationEventSessionLinkForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: number;
}) {
  const result = await getDashboardOrganizationEventForAuthUser(input);

  if (!result) {
    return null;
  }

  const [link] = await getDb()
    .select(dashboardEventSessionLinkSelection)
    .from(eventAccessLinks)
    .where(
      and(
        eq(eventAccessLinks.eventId, result.event.id),
        eq(eventAccessLinks.active, true),
        isNull(eventAccessLinks.revokedAt),
      ),
    )
    .orderBy(desc(eventAccessLinks.createdAt), desc(eventAccessLinks.id))
    .limit(1);

  return {
    ...result,
    sessionLink: link ?? null,
  };
}

export async function generateDashboardOrganizationEventSessionLinkForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: number;
}) {
  return getDb().transaction(async (transaction) => {
    const { organization, event } =
      await requireEventManagerOrganizationEventInTransaction(
        transaction,
        input.authUserId,
        input.organizationId,
        input.eventId,
      );

    return createEventSessionLinkInTransaction(transaction, organization, event);
  });
}

export async function generateDashboardOrganizationEventShareLinkForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: number;
}) {
  return getDb().transaction(async (transaction) => {
    const { organization, event } =
      await requireEventSharerOrganizationEventInTransaction(
        transaction,
        input.authUserId,
        input.organizationId,
        input.eventId,
      );

    return createEventSessionLinkInTransaction(transaction, organization, event);
  });
}

export async function createDashboardOrganizationEventForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  event: CreateDashboardEventInput;
}) {
  return getDb().transaction(async (transaction) => {
    const organization = await requireEventCreatorOrganizationInTransaction(
      transaction,
      input.authUserId,
      input.organizationId,
    );
    const now = new Date();

    await assertNoActivePublicEventConflictInTransaction(transaction, {
      workspaceId: organization.id,
      nextIsActivePublicEvent: input.event.isActivePublicEvent,
    });

    const [event] = await transaction
      .insert(events)
      .values({
        workspaceId: organization.id,
        name: input.event.title,
        venue: input.event.venue,
        startsAt: input.event.startsAt,
        autoCloseAt: input.event.autoCloseAt,
        facebookUrl: input.event.facebookUrl,
        status: input.event.isActivePublicEvent ? "active" : "draft",
        isActivePublicEvent: input.event.isActivePublicEvent,
        publicQueueEnabled: input.event.publicQueueEnabled,
        publicShowSongTitles: input.event.publicShowSongTitles,
        updatedAt: now,
      })
      .returning(dashboardEventSelection);

    if (!event) {
      throw new Error("Event could not be created.");
    }

    await transaction.insert(operatorAuditLog).values({
      operatorId: organization.operatorId,
      eventId: event.id,
      action: "create_event",
      entityId: String(event.id),
      payload: {
        startsAt: input.event.startsAt.toISOString(),
        autoCloseAt: input.event.autoCloseAt.toISOString(),
        publicQueueEnabled: input.event.publicQueueEnabled,
        publicShowSongTitles: input.event.publicShowSongTitles,
        isActivePublicEvent: input.event.isActivePublicEvent,
        facebookUrlProvided: Boolean(input.event.facebookUrl),
      },
    });

    return {
      organization,
      event,
    };
  });
}

export async function updateDashboardOrganizationEventAutoCloseAtForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: number;
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
      operatorId: organization.operatorId,
      eventId: event.id,
      action: "update_event_auto_close_at",
      entityId: String(event.id),
      payload: {
        previousAutoCloseAt: event.autoCloseAt?.toISOString() ?? null,
        autoCloseAt: input.event.autoCloseAt.toISOString(),
      },
    });

    return {
      organization,
      event: updatedEvent,
    };
  });
}

export async function updateDashboardOrganizationEventDetailsForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: number;
  event: UpdateDashboardEventDetailsInput;
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

    const [updatedEvent] = await transaction
      .update(events)
      .set({
        name: input.event.title,
        venue: input.event.venue,
        startsAt: input.event.startsAt,
        autoCloseAt: input.event.autoCloseAt,
        facebookUrl: input.event.facebookUrl,
        status: input.event.isActivePublicEvent ? "active" : event.status,
        isActivePublicEvent: input.event.isActivePublicEvent,
        publicQueueEnabled: input.event.publicQueueEnabled,
        publicShowSongTitles: input.event.publicShowSongTitles,
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
      operatorId: organization.operatorId,
      eventId: event.id,
      action: "update_dashboard_event_details",
      entityId: String(event.id),
      payload: {
        previous: {
          startsAt: event.startsAt.toISOString(),
          autoCloseAt: event.autoCloseAt?.toISOString() ?? null,
          publicQueueEnabled: event.publicQueueEnabled,
          publicShowSongTitles: event.publicShowSongTitles,
          isActivePublicEvent: event.isActivePublicEvent,
          facebookUrlProvided: Boolean(event.facebookUrl),
        },
        next: {
          startsAt: input.event.startsAt.toISOString(),
          autoCloseAt: input.event.autoCloseAt.toISOString(),
          publicQueueEnabled: input.event.publicQueueEnabled,
          publicShowSongTitles: input.event.publicShowSongTitles,
          isActivePublicEvent: input.event.isActivePublicEvent,
          facebookUrlProvided: Boolean(input.event.facebookUrl),
        },
      },
    });

    return {
      organization,
      event: updatedEvent,
    };
  });
}

export async function extendDashboardOrganizationEventForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: number;
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

    const autoCloseAt = calculateDashboardEventExtendedAutoCloseAt({
      autoCloseAt: event.autoCloseAt,
      minutes: input.extension.minutes,
      now,
    });

    if (autoCloseAt.getTime() <= event.startsAt.getTime()) {
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
      operatorId: organization.operatorId,
      eventId: event.id,
      action: "extend_dashboard_event",
      entityId: String(event.id),
      payload: {
        minutes: input.extension.minutes,
        previousAutoCloseAt: event.autoCloseAt?.toISOString() ?? null,
        autoCloseAt: autoCloseAt.toISOString(),
      },
    });

    return {
      organization,
      event: updatedEvent,
    };
  });
}

export async function closeDashboardOrganizationEventForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  eventId: number;
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

    return {
      organization,
      event: closedEvent,
    };
  });
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

type DashboardOrganizationEventActionOrganization = DashboardOrganization & {
  operatorId: number;
};

async function createEventSessionLinkInTransaction(
  transaction: DatabaseTransaction,
  organization: DashboardOrganizationEventActionOrganization,
  event: DashboardOrganizationEvent,
) {
  const now = new Date();
  const code = generateEventAccessCode();
  const codeHash = hashEventAccessCode(code);

  const activeLinks = await transaction
    .select({ id: eventAccessLinks.id })
    .from(eventAccessLinks)
    .where(
      and(
        eq(eventAccessLinks.eventId, event.id),
        eq(eventAccessLinks.active, true),
        isNull(eventAccessLinks.revokedAt),
      ),
    )
    .for("update");

  if (activeLinks.length > 0) {
    await transaction
      .update(eventAccessLinks)
      .set({
        active: false,
        revokedAt: now,
      })
      .where(
        and(
          eq(eventAccessLinks.eventId, event.id),
          eq(eventAccessLinks.active, true),
          isNull(eventAccessLinks.revokedAt),
        ),
      );
  }

  const [link] = await transaction
    .insert(eventAccessLinks)
    .values({
      eventId: event.id,
      codeHash,
      label: "Link sesji",
      createdByOperatorId: organization.operatorId,
    })
    .returning(dashboardEventSessionLinkSelection);

  if (!link) {
    throw new Error("Session link could not be created.");
  }

  await transaction.insert(operatorAuditLog).values({
    operatorId: organization.operatorId,
    eventId: event.id,
    action: "generate_event_session_link",
    entityId: String(link.id),
    payload: {
      active: link.active,
      revokedPreviousLinks: activeLinks.length,
    },
  });

  return {
    organization,
    event,
    link,
    code,
    sessionPath: `/session/${encodeURIComponent(code)}`,
  };
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
  eventId: number,
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
    .where(and(eq(events.workspaceId, organization.id), eq(events.id, eventId)))
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

async function requireEventSharerOrganizationEventInTransaction(
  transaction: DatabaseTransaction,
  authUserId: string,
  organizationId: string,
  eventId: number,
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
      ),
    )
    .limit(1);

  if (!organization || !canShareDashboardOrganizationEvent(organization.role)) {
    throw new OperatorApiError(
      403,
      "WORKSPACE_EVENT_SHARE_FORBIDDEN",
      "Only an owner, manager, or operator can share events.",
    );
  }

  const [event] = await transaction
    .select(dashboardEventSelection)
    .from(events)
    .where(and(eq(events.workspaceId, organization.id), eq(events.id, eventId)))
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
