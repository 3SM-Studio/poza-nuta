import { desc } from "drizzle-orm";

import { importJobs } from "../../db/schema.ts";
import type { ImportJobSafeRow } from "./import-admin-core.ts";

type Database = typeof import("../db.ts").getDb extends () => infer T ? T : never;

export async function readRecentImportJobs(
  database: Database,
  limit: number,
): Promise<ImportJobSafeRow[]> {
  return database
    .select({
      id: importJobs.id,
      source: importJobs.source,
      mode: importJobs.mode,
      status: importJobs.status,
      initiatorKind: importJobs.initiatorKind,
      createdAt: importJobs.createdAt,
      startedAt: importJobs.startedAt,
      terminalAt: importJobs.terminalAt,
      totalCount: importJobs.totalCount,
      processedCount: importJobs.processedCount,
      importedCount: importJobs.importedCount,
      skippedCount: importJobs.skippedCount,
      errorCount: importJobs.errorCount,
      safeErrorCode: importJobs.safeErrorCode,
      safeErrorSummary: importJobs.safeErrorSummary,
      cancellationRequestedAt: importJobs.cancellationRequestedAt,
    })
    .from(importJobs)
    .orderBy(desc(importJobs.createdAt), desc(importJobs.id))
    .limit(limit);
}
