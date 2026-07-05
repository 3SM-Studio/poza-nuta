import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LAST_SELECTED_ORGANIZATION_COOKIE } from "@/lib/dashboard-last-selected-organization";
import { resolveDashboardHomeRedirect } from "@/lib/dashboard-routes";

import { listDashboardOrganizationsForAuthUser } from "../../server/operator-api/organizations";
import { requireOperatorSession } from "../../server/operator-api/supabase-session";
import { traceServerStep } from "../../server/runtime-diagnostics";

export const metadata: Metadata = {
  title: "Dashboard | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireOperatorSession("dashboard.home");
  const organizations = await traceServerStep(
    "dashboard.home",
    "listOrganizations",
    () => listDashboardOrganizationsForAuthUser(session.authUser.id),
  );
  const cookieStore = await cookies();
  const lastSelectedOrganizationId =
    cookieStore.get(LAST_SELECTED_ORGANIZATION_COOKIE)?.value ?? null;

  redirect(resolveDashboardHomeRedirect(organizations, lastSelectedOrganizationId));
}
