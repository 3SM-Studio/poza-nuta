import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { DashboardShell } from "../../components/operator/dashboard-shell";
import { DashboardRuntimeError } from "../../components/operator/dashboard-runtime-error";
import { OperatorApiError } from "../../server/operator-api/errors";
import { listDashboardOrganizationsForAuthUser } from "../../server/operator-api/organizations";
import {
  getOperatorDisplayName,
  requireOperatorSession,
} from "../../server/operator-api/supabase-session";
import {
  isTransientInfrastructureError,
  traceServerStep,
} from "../../server/runtime-diagnostics";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  let session: Awaited<ReturnType<typeof getDashboardSession>>;
  let organizations: Array<{
    id: number;
    name: string;
    organizationId: string;
    role: string;
  }>;

  try {
    session = await getDashboardSession();
    organizations = await traceServerStep(
      "dashboard.layout",
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
  } catch (error) {
    if (isTransientInfrastructureError(error)) {
      return <DashboardRuntimeError />;
    }

    throw error;
  }

  return (
    <DashboardShell
      organizations={organizations}
      operatorName={getOperatorDisplayName(session.operator)}
      email={session.authUser.email}
    >
      {children}
    </DashboardShell>
  );
}

async function getDashboardSession() {
  try {
    return await requireOperatorSession("dashboard.layout");
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
