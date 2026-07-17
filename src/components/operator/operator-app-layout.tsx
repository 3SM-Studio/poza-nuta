import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SIDEBAR_COOKIE_NAME } from "@/components/app-shell/sidebar-state";
import { SidebarProvider } from "@/components/ui/sidebar";
import { OperatorApiError } from "@/server/operator-api/errors";
import { listDashboardOrganizationsForAuthUser } from "@/server/operator-api/organizations";
import {
  getOperatorDisplayName,
  requireOperatorSession,
} from "@/server/operator-api/supabase-session";
import { requirePlatformAdminAccess } from "@/server/platform-admin/guard";
import { resolvePlatformAdminPageAccess } from "@/server/platform-admin/page-access-core";
import {
  isTransientInfrastructureError,
  traceServerStep,
} from "@/server/runtime-diagnostics";

import { DashboardRuntimeError } from "./dashboard-runtime-error";
import { DashboardShell } from "./dashboard-shell";

export async function OperatorAppLayout({ children }: { children: ReactNode }) {
  let session: Awaited<ReturnType<typeof getOperatorLayoutSession>>;
  let organizations: Array<{
    id: number;
    name: string;
    organizationId: string;
    role: string;
  }>;
  let canAccessAdmin: boolean;

  try {
    session = await getOperatorLayoutSession();
    organizations = await traceServerStep(
      "operator.layout",
      "listOrganizations",
      () => listDashboardOrganizationsForAuthUser(session.authUser.id),
    ).then((items) =>
      items.map((organization) => ({
        id: organization.id,
        name: organization.name,
        organizationId: organization.publicId,
        role: organization.role,
      })),
    );
    const platformAccess = await resolvePlatformAdminPageAccess(() =>
      requirePlatformAdminAccess("admin.access"),
    );
    canAccessAdmin = platformAccess.kind === "allowed";
  } catch (error) {
    if (isTransientInfrastructureError(error)) {
      return <DashboardRuntimeError />;
    }

    throw error;
  }

  const cookieStore = await cookies();
  const sidebarDefaultOpen =
    cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";

  return (
    <SidebarProvider
      defaultOpen={sidebarDefaultOpen}
      data-management-theme="true"
      className="bg-sidebar text-foreground"
    >
      <DashboardShell
        organizations={organizations}
        operatorName={getOperatorDisplayName(session.operator)}
        email={session.authUser.email}
        canAccessAdmin={canAccessAdmin}
      >
        {children}
      </DashboardShell>
    </SidebarProvider>
  );
}

async function getOperatorLayoutSession() {
  try {
    return await requireOperatorSession("operator.layout");
  } catch (error) {
    if (
      error instanceof OperatorApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      redirect("/sign-in");
    }

    throw error;
  }
}
