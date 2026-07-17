import { AdminImportsPanel } from "@/components/platform-admin/admin-imports-panel";
import { getPlatformAdminImports } from "@/server/platform-admin/import-admin";

import {
  cancelImportJobAction,
  startISingDryRunAction,
  startISingWriteAction,
} from "./actions";

export default async function PlatformAdminImportsPage() {
  const data = await getPlatformAdminImports();

  return (
    <AdminImportsPanel
      data={data}
      startDryRun={startISingDryRunAction}
      startWrite={startISingWriteAction}
      cancelJob={cancelImportJobAction}
    />
  );
}
