import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";

import { events, songs, songRequests, workspaceMembers } from "../../db/schema";
import { getDb } from "../db";
import { traceServerStep } from "../runtime-diagnostics";
import { getDashboardOrganizationForAuthUser } from "./organizations";
import {
  logDashboardOverviewDegraded,
  resolveOptionalOverviewSection,
} from "./overview-fallback";

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
  partialFailures: {
    counts: boolean;
    activeEvent: boolean;
    recentEvents: boolean;
    topRequestedSongs: boolean;
  };
};

const countSelection = {
  value: sql<number>`count(*)::int`,
};

const EMPTY_OVERVIEW_STATS: DashboardOrganizationOverview["stats"] = {
  activeEvents: 0,
  totalEvents: 0,
  requestsToday: 0,
  requestsLastSevenDays: 0,
  pendingRequests: 0,
  acceptedRequests: 0,
  performedRequests: 0,
  members: 0,
  catalogSongs: 0,
};

export async function getDashboardOrganizationOverviewForAuthUser(
  authUserId: string,
  organizationId: string,
): Promise<DashboardOrganizationOverview | null> {
  const organization = await traceServerStep(
    "dashboard.org",
    "resolveOrganization",
    () => getDashboardOrganizationForAuthUser(authUserId, organizationId),
  );

  if (!organization) {
    return null;
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const statsResult = await resolveOptionalOverviewSection({
    routeName: "dashboard.org",
    stepName: "overview.counts",
    action: () =>
      getOverviewStatsForWorkspace({
        workspaceId: organization.id,
        todayStart,
        sevenDaysAgo,
      }),
    fallback: EMPTY_OVERVIEW_STATS,
  });
  const activeEventResult = await resolveOptionalOverviewSection({
    routeName: "dashboard.org",
    stepName: "activeEvent",
    action: () => getActiveEventForWorkspace(organization.id),
    fallback: null,
  });
  const recentEventsResult = await resolveOptionalOverviewSection({
    routeName: "dashboard.org",
    stepName: "recentEvents",
    action: () => getRecentEventsForWorkspace(organization.id),
    fallback: [],
  });
  const topRequestedSongsResult = await resolveOptionalOverviewSection({
    routeName: "dashboard.org",
    stepName: "topSongs",
    action: () => getTopRequestedSongsForWorkspace(organization.id),
    fallback: [],
  });

  const stats = statsResult.data;
  const activeEvent = activeEventResult.data;
  const recentEvents = recentEventsResult.data;
  const topRequestedSongs = topRequestedSongsResult.data;
  const degradedSections = [
    statsResult.failed ? "counts" : null,
    activeEventResult.failed ? "activeEvent" : null,
    recentEventsResult.failed ? "recentEvents" : null,
    topRequestedSongsResult.failed ? "topSongs" : null,
  ].filter((section): section is string => Boolean(section));

  logDashboardOverviewDegraded({
    routeName: "dashboard.org",
    sections: degradedSections,
  });

  return {
    organization,
    stats,
    activeEvent,
    recentEvents,
    topRequestedSongs,
    partialFailures: {
      counts: statsResult.failed,
      activeEvent: activeEventResult.failed,
      recentEvents: recentEventsResult.failed,
      topRequestedSongs: topRequestedSongsResult.failed,
    },
  };
}

async function getOverviewStatsForWorkspace(input: {
  workspaceId: number;
  todayStart: Date;
  sevenDaysAgo: Date;
}): Promise<DashboardOrganizationOverview["stats"]> {
  const eventStats = await traceServerStep(
    "dashboard.org",
    "overview.counts.events",
    () => countEventStatsForWorkspace(input.workspaceId),
  );
  const requestStats = await traceServerStep(
    "dashboard.org",
    "overview.counts.requests",
    () =>
      countRequestStatsForWorkspace({
        workspaceId: input.workspaceId,
        todayStart: input.todayStart,
        sevenDaysAgo: input.sevenDaysAgo,
      }),
  );
  const members = await traceServerStep(
    "dashboard.org",
    "overview.counts.members",
    () => countMembersForWorkspace(input.workspaceId),
  );
  const catalogSongs = await traceServerStep(
    "dashboard.org",
    "overview.counts.catalogSongs",
    () => countCatalogSongs(),
  );

  return {
    ...eventStats,
    ...requestStats,
    members,
    catalogSongs,
  };
}

async function countEventStatsForWorkspace(workspaceId: number) {
  const [result] = await getDb()
    .select({
      activeEvents: sql<number>`count(*) filter (where ${events.status} = 'active')::int`,
      totalEvents: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(eq(events.workspaceId, workspaceId));

  return {
    activeEvents: result?.activeEvents ?? 0,
    totalEvents: result?.totalEvents ?? 0,
  };
}

async function countRequestStatsForWorkspace(input: {
  workspaceId: number;
  todayStart: Date;
  sevenDaysAgo: Date;
}) {
  const todayStart = input.todayStart.toISOString();
  const sevenDaysAgo = input.sevenDaysAgo.toISOString();

  const [result] = await getDb()
    .select({
      requestsToday: sql<number>`count(*) filter (where ${songRequests.createdAt} >= ${todayStart}::timestamptz)::int`,
      requestsLastSevenDays: sql<number>`count(*) filter (where ${songRequests.createdAt} >= ${sevenDaysAgo}::timestamptz)::int`,
      pendingRequests: sql<number>`count(*) filter (where ${songRequests.status} = 'pending')::int`,
      acceptedRequests: sql<number>`count(*) filter (where ${songRequests.status} = 'approved')::int`,
      performedRequests: sql<number>`count(*) filter (where ${songRequests.status} = 'done')::int`,
    })
    .from(songRequests)
    .innerJoin(events, eq(events.id, songRequests.eventId))
    .where(eq(events.workspaceId, input.workspaceId));

  return {
    requestsToday: result?.requestsToday ?? 0,
    requestsLastSevenDays: result?.requestsLastSevenDays ?? 0,
    pendingRequests: result?.pendingRequests ?? 0,
    acceptedRequests: result?.acceptedRequests ?? 0,
    performedRequests: result?.performedRequests ?? 0,
  };
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
  const requestedSince = new Date();
  requestedSince.setDate(requestedSince.getDate() - 30);

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
    .where(
      and(
        eq(events.workspaceId, workspaceId),
        gte(songRequests.createdAt, requestedSince),
      ),
    )
    .groupBy(songs.id, songs.title, songs.artist)
    .orderBy(desc(sql<number>`count(${songRequests.id})::int`), songs.title)
    .limit(5);
}
