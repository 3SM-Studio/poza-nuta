import "server-only";

import { getDb } from "../db";
import { requirePlatformAdminAccess } from "./guard";
import { loadPlatformAdminOverviewWithDependencies } from "./overview-core";
import { readPlatformAdminOverviewMetrics } from "./overview-store";

export async function getPlatformAdminOverview() {
  return loadPlatformAdminOverviewWithDependencies({
    requireAccess: () => requirePlatformAdminAccess("admin.access"),
    readMetrics: () => readPlatformAdminOverviewMetrics(getDb()),
  });
}
