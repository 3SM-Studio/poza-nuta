import { and, eq, isNull, sql } from "drizzle-orm";

import {
  events,
  operatorUsers,
  platformMembers,
  songs,
  workspaces,
} from "../../db/schema.ts";
import type { PlatformAdminOverviewMetrics } from "./overview-core.ts";
import type { PlatformRole } from "./policy.ts";

type Database = typeof import("../db.ts").getDb extends () => infer T
  ? T
  : never;

const countSelection = {
  value: sql<number>`count(*)::int`,
};

export async function readPlatformAdminOverviewMetrics(
  database: Database,
): Promise<PlatformAdminOverviewMetrics> {
  const [
    activeOperatorsRows,
    eligibleOwnersRows,
    membershipRows,
    activeWorkspaceRows,
    catalogSongRows,
    activePublicEventRows,
  ] = await Promise.all([
    database
      .select(countSelection)
      .from(operatorUsers)
      .where(
        and(eq(operatorUsers.active, true), isNull(operatorUsers.suspendedAt)),
      ),
    database
      .select(countSelection)
      .from(platformMembers)
      .innerJoin(
        operatorUsers,
        eq(operatorUsers.id, platformMembers.operatorUserId),
      )
      .where(
        and(
          eq(platformMembers.active, true),
          eq(platformMembers.role, "platform_owner"),
          eq(operatorUsers.active, true),
          isNull(operatorUsers.suspendedAt),
        ),
      ),
    database
      .select({
        role: platformMembers.role,
        value: sql<number>`count(*)::int`,
      })
      .from(platformMembers)
      .where(eq(platformMembers.active, true))
      .groupBy(platformMembers.role),
    database
      .select(countSelection)
      .from(workspaces)
      .where(eq(workspaces.active, true)),
    database.select(countSelection).from(songs),
    database
      .select(countSelection)
      .from(events)
      .where(eq(events.isActivePublicEvent, true)),
  ]);

  const activePlatformMemberships: Record<PlatformRole, number> = {
    platform_owner: 0,
    platform_admin: 0,
    support: 0,
  };

  for (const row of membershipRows) {
    activePlatformMemberships[row.role] = row.value;
  }

  return {
    activeOperators: activeOperatorsRows[0]?.value ?? 0,
    eligibleOwners: eligibleOwnersRows[0]?.value ?? 0,
    activePlatformMemberships,
    activeWorkspaces: activeWorkspaceRows[0]?.value ?? 0,
    catalogSongs: catalogSongRows[0]?.value ?? 0,
    activePublicEvents: activePublicEventRows[0]?.value ?? 0,
  };
}
