import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { events, operatorUsers, workspaceMembers, workspaces } from "../../db/schema";
import { getDb } from "../db";

export type DashboardOrganizationRole =
  | "owner"
  | "manager"
  | "operator"
  | "viewer";

export type DashboardOrganization = {
  id: number;
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

const organizationSelection = {
  id: workspaces.id,
  name: workspaces.name,
  handle: workspaces.handle,
  active: workspaces.active,
  role: workspaceMembers.role,
};

export async function listDashboardOrganizationsForAuthUser(
  authUserId: string,
) {
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
    .orderBy(workspaces.name, workspaces.handle);
}

export async function getDashboardOrganizationForAuthUser(
  authUserId: string,
  orgHandle: string,
) {
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
        eq(workspaces.handle, orgHandle),
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
  orgHandle: string,
) {
  const organization = await getDashboardOrganizationForAuthUser(
    authUserId,
    orgHandle,
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
