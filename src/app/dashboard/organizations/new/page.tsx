import { redirect } from "next/navigation";

import { getDashboardNewOrganizationPath } from "@/lib/dashboard-routes";

export const dynamic = "force-dynamic";

export default function LegacyNewDashboardOrganizationPage() {
  redirect(getDashboardNewOrganizationPath());
}
