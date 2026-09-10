import "server-only";

import { getDb } from "../db.ts";
import { requirePlatformAdminAccess } from "./guard.ts";
import { loadImportAdminPageWithDependencies } from "./import-admin-core.ts";
import { readRecentImportJobs } from "./import-admin-store.ts";

export function getPlatformAdminImports() {
  return loadImportAdminPageWithDependencies({
    requireAccess: () =>
      requirePlatformAdminAccess("catalog_import_history.read"),
    readRecentJobs: (limit) => readRecentImportJobs(getDb(), limit),
  });
}
