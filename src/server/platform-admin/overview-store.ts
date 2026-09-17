import { sql } from "drizzle-orm";

import {
  events,
  operatorUsers,
  platformMembers,
  songs,
  workspaces,
} from "../../db/schema.ts";
import type { PlatformAdminOverviewMetrics } from "./overview-core.ts";

type Database = typeof import("../db.ts").getDb extends () => infer T
  ? T
  : never;

type OverviewRow = {
  activeOperators: number;
  eligibleOwners: number;
  platformOwners: number;
  platformAdmins: number;
  supportMembers: number;
  activeWorkspaces: number;
  catalogSongs: number;
  activePublicEvents: number;
};

export async function readPlatformAdminOverviewMetrics(
  database: Database,
): Promise<PlatformAdminOverviewMetrics> {
  const [row] = await database.execute<OverviewRow>(sql`
        select
        (
          select count(*)::int from ${operatorUsers}
          where ${operatorUsers.active} = true
            and ${operatorUsers.suspendedAt} is null
        ) as "activeOperators",
        (
          select count(*)::int from ${platformMembers}
          inner join ${operatorUsers}
            on ${operatorUsers.id} = ${platformMembers.operatorUserId}
          where ${platformMembers.active} = true
            and ${platformMembers.role} = 'platform_owner'
            and ${operatorUsers.active} = true
            and ${operatorUsers.suspendedAt} is null
        ) as "eligibleOwners",
        (
          select count(*)::int from ${platformMembers}
          where ${platformMembers.active} = true
            and ${platformMembers.role} = 'platform_owner'
        ) as "platformOwners",
        (
          select count(*)::int from ${platformMembers}
          where ${platformMembers.active} = true
            and ${platformMembers.role} = 'platform_admin'
        ) as "platformAdmins",
        (
          select count(*)::int from ${platformMembers}
          where ${platformMembers.active} = true
            and ${platformMembers.role} = 'support'
        ) as "supportMembers",
        (
          select count(*)::int from ${workspaces}
          where ${workspaces.active} = true
        ) as "activeWorkspaces",
        (select count(*)::int from ${songs}) as "catalogSongs",
        (
          select count(*)::int from ${events}
          where ${events.isActivePublicEvent} = true
        ) as "activePublicEvents"
      `);

  if (!row) {
    throw new Error("Platform admin overview metrics query returned no row.");
  }

  return {
    activeOperators: row.activeOperators,
    eligibleOwners: row.eligibleOwners,
    activePlatformMemberships: {
      platform_owner: row.platformOwners,
      platform_admin: row.platformAdmins,
      support: row.supportMembers,
    },
    activeWorkspaces: row.activeWorkspaces,
    catalogSongs: row.catalogSongs,
    activePublicEvents: row.activePublicEvents,
  };
}
