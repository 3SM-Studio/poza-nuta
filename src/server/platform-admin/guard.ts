import "server-only";

import { and, eq } from "drizzle-orm";

import { platformMembers } from "@/db/schema";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";

import { getDb } from "../db";
import {
  authorizePlatformAdminSession,
  type ActivePlatformMembership,
} from "./guard-core";
import type { PlatformPermission } from "./policy";

export async function requirePlatformAdminAccess(
  permission: PlatformPermission = "admin.access",
) {
  return authorizePlatformAdminSession(permission, {
    requireOperatorSession: () =>
      requireOperatorSession("platform-admin.authorization"),
    findActivePlatformMembership,
  });
}

async function findActivePlatformMembership(
  operatorUserId: number,
): Promise<ActivePlatformMembership | null> {
  const [membership] = await getDb()
    .select({
      id: platformMembers.id,
      operatorUserId: platformMembers.operatorUserId,
      role: platformMembers.role,
      active: platformMembers.active,
    })
    .from(platformMembers)
    .where(
      and(
        eq(platformMembers.operatorUserId, operatorUserId),
        eq(platformMembers.active, true),
      ),
    )
    .limit(1);

  if (!membership) {
    return null;
  }

  return {
    ...membership,
    active: true,
  };
}
