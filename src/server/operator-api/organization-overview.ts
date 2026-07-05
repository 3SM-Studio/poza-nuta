import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";

import { events, songs, songRequests, workspaceMembers } from "../../db/schema";
import { getDb } from "../db";
import { getDashboardOrganizationForAuthUser } from "./organizations";

type RequestStatus = "pending" | "approved" | "now" | "done" | "skipped" | "rejected";

export type DashboardOrganizationOverview = {
  organization: NonNullable<
    Awaited<ReturnType<typeof getDashboardOrganizationForAuthUser>>
  >;
  stats: {
    activeEvents: number;
    totalEvents: number;
    requestsToday: number;
    requestsLastSevenDays: number;
    pendingRequests: number;
    acceptedRequests: number;
    performedRequests: number;
    members: number;
    catalogSongs: number;
  };
  activeEvent: {
    id: number;
    name: string;
    venue: string | null;
    startsAt: Date;
    publicQueueEnabled: boolean;
    publicShowSongTitles: boolean;
  } | null;
  recentEvents: Array<{
    id: number;
    name: string;
    venue: string | null;
    startsAt: Date;
    status: "draft" | "active" | "closed";
  }>;
  topRequestedSongs: Array<{
    songId: number;
    title: string;
    artist: string;
    requestCount: number;
  }>;
};

const countSelection = {
  value: sql<number>`count(*)::int`,
};

export async function getDashboardOrganizationOverviewForAuthUser(
  authUserId: string,
  organizationId: string,
): Promise<DashboardOrganizationOverview | null> {
  const organization = await getDashboardOrganizationForAuthUser(
    authUserId,
    organizationId,
  );

  if (!organization) {
    return null;
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [
    activeEvents,
    totalEvents,
    requestsToday,
    requestsLastSevenDays,
    pendingRequests,
    acceptedRequests,
    performedRequests,
    memberCount,
    catalogSongs,
    activeEvent,
    recentEvents,
    topRequestedSongs,
  ] = await Promise.all([
    countEventsForWorkspace(organization.id, "active"),
    countEventsForWorkspace(organization.id),
    countRequestsForWorkspace({
      workspaceId: organization.id,
      createdSince: todayStart,
    }),
    countRequestsForWorkspace({
      workspaceId: organization.id,
      createdSince: sevenDaysAgo,
    }),
    countRequestsForWorkspace({
      workspaceId: organization.id,
      status: "pending",
    }),
    countRequestsForWorkspace({
      workspaceId: organization.id,
      status: "approved",
    }),
    countRequestsForWorkspace({
      workspaceId: organization.id,
      status: "done",
    }),
    countMembersForWorkspace(organization.id),
    countCatalogSongs(),
    getActiveEventForWorkspace(organization.id),
    getRecentEventsForWorkspace(organization.id),
    getTopRequestedSongsForWorkspace(organization.id),
  ]);

  return {
    organization,
    stats: {
      activeEvents,
      totalEvents,
      requestsToday,
      requestsLastSevenDays,
      pendingRequests,
      acceptedRequests,
      performedRequests,
      members: memberCount,
      catalogSongs,
    },
    activeEvent,
    recentEvents,
    topRequestedSongs,
  };
}

async function countEventsForWorkspace(
  workspaceId: number,
  status?: "draft" | "active" | "closed",
) {
  const [result] = await getDb()
    .select(countSelection)
    .from(events)
    .where(
      status
        ? and(eq(events.workspaceId, workspaceId), eq(events.status, status))
        : eq(events.workspaceId, workspaceId),
    );

  return result?.value ?? 0;
}

async function countRequestsForWorkspace(input: {
  workspaceId: number;
  status?: RequestStatus;
  createdSince?: Date;
}) {
  const conditions = [eq(events.workspaceId, input.workspaceId)];

  if (input.status) {
    conditions.push(eq(songRequests.status, input.status));
  }

  if (input.createdSince) {
    conditions.push(gte(songRequests.createdAt, input.createdSince));
  }

  const [result] = await getDb()
    .select(countSelection)
    .from(songRequests)
    .innerJoin(events, eq(events.id, songRequests.eventId))
    .where(and(...conditions));

  return result?.value ?? 0;
}

async function countMembersForWorkspace(workspaceId: number) {
  const [result] = await getDb()
    .select(countSelection)
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.active, true),
      ),
    );

  return result?.value ?? 0;
}

async function countCatalogSongs() {
  const [result] = await getDb().select(countSelection).from(songs);

  return result?.value ?? 0;
}

async function getActiveEventForWorkspace(workspaceId: number) {
  const [event] = await getDb()
    .select({
      id: events.id,
      name: events.name,
      venue: events.venue,
      startsAt: events.startsAt,
      publicQueueEnabled: events.publicQueueEnabled,
      publicShowSongTitles: events.publicShowSongTitles,
    })
    .from(events)
    .where(and(eq(events.workspaceId, workspaceId), eq(events.status, "active")))
    .orderBy(desc(events.startsAt), desc(events.id))
    .limit(1);

  return event ?? null;
}

async function getRecentEventsForWorkspace(workspaceId: number) {
  return getDb()
    .select({
      id: events.id,
      name: events.name,
      venue: events.venue,
      startsAt: events.startsAt,
      status: events.status,
    })
    .from(events)
    .where(eq(events.workspaceId, workspaceId))
    .orderBy(desc(events.startsAt), desc(events.id))
    .limit(5);
}

async function getTopRequestedSongsForWorkspace(workspaceId: number) {
  return getDb()
    .select({
      songId: songs.id,
      title: songs.title,
      artist: songs.artist,
      requestCount: sql<number>`count(${songRequests.id})::int`,
    })
    .from(songRequests)
    .innerJoin(events, eq(events.id, songRequests.eventId))
    .innerJoin(songs, eq(songs.id, songRequests.songId))
    .where(eq(events.workspaceId, workspaceId))
    .groupBy(songs.id, songs.title, songs.artist)
    .orderBy(desc(sql<number>`count(${songRequests.id})::int`), songs.title)
    .limit(5);
}
