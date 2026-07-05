import "server-only";

import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";

import { events, operatorUsers, workspaceMembers, workspaces } from "../../db/schema";
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
  status: "draft" | "active" | "closed";
  isActivePublicEvent: boolean;
  publicQueueEnabled: boolean;
  publicShowSongTitles: boolean;
  autoCloseAt: Date | null;
  closedAt: Date | null;
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
    })
    .from(events)
    .where(eq(events.workspaceId, organization.id))
    .orderBy(desc(events.startsAt), desc(events.id));

  return {
    organization,
    events: organizationEvents,
  };
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
      operatorName: operatorUsers.name,
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
