import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LAST_SELECTED_ORGANIZATION_COOKIE } from "@/lib/dashboard-last-selected-organization";
import { resolveDashboardHomeRedirect } from "@/lib/dashboard-routes";

import { DashboardRuntimeError } from "../../components/operator/dashboard-runtime-error";
import { listDashboardOrganizationsForAuthUser } from "../../server/operator-api/organizations";
import { requireOperatorSession } from "../../server/operator-api/supabase-session";
import {
  isTransientInfrastructureError,
  traceServerStep,
  traceServerStepSync,
} from "../../server/runtime-diagnostics";

export const metadata: Metadata = {
  title: "Dashboard | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let organizations: Awaited<
    ReturnType<typeof listDashboardOrganizationsForAuthUser>
  >;

  try {
    const session = await requireOperatorSession("dashboard.home");
    organizations = await traceServerStep(
      "dashboard.home",
      "listOrganizations",
      () => listDashboardOrganizationsForAuthUser(session.authUser.id),
    );
  } catch (error) {
    if (isTransientInfrastructureError(error)) {
      return <DashboardRuntimeError />;
    }

    throw error;
  }

  const cookieStore = await cookies();
  const lastSelectedOrganizationId =
    cookieStore.get(LAST_SELECTED_ORGANIZATION_COOKIE)?.value ?? null;
  const redirectTarget = traceServerStepSync(
    "dashboard.home",
    "resolveRedirectTarget",
    () => resolveDashboardHomeRedirect(organizations, lastSelectedOrganizationId),
  );

  redirect(redirectTarget);
}
