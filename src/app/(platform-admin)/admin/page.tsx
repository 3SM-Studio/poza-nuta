import { AdminOverview } from "@/components/platform-admin/admin-overview";
import { getPlatformAdminOverview } from "@/server/platform-admin/overview";

export default async function PlatformAdminOverviewPage() {
  const metrics = await getPlatformAdminOverview();

  return <AdminOverview metrics={metrics} />;
}
