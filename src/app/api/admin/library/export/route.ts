import { getDb } from "@/server/db";
import { requirePlatformAdminAccess } from "@/server/platform-admin/guard";
import {
  createLibraryExportDataSource,
  generateLibraryExport,
} from "@/server/platform-admin/library-export";
import {
  handleLibraryExportRequest,
} from "@/server/platform-admin/library-export-http";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return handleLibraryExportRequest({
    requireAccess: requirePlatformAdminAccess,
    generateExport: () =>
      generateLibraryExport(createLibraryExportDataSource(getDb())),
  });
}
