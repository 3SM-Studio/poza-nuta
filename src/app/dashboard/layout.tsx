import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { DashboardShell } from "../../components/operator/dashboard-shell";
import { OperatorApiError } from "../../server/operator-api/errors";
import { listDashboardOrganizationsForAuthUser } from "../../server/operator-api/organizations";
import { requireOperatorSession } from "../../server/operator-api/supabase-session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const session = await getDashboardSession();
  const organizations = await listDashboardOrganizationsForAuthUser(
    session.authUser.id,
  ).then((items) =>
    items.map((organization) => ({
      id: organization.id,
      name: organization.name,
      organizationId: organization.publicId,
      role: organization.role,
    })),
  );

  return (
    <DashboardShell
      organizations={organizations}
      operatorName={session.operator.name}
      email={session.authUser.email}
    >
      {children}
    </DashboardShell>
  );
}

async function getDashboardSession() {
  try {
    return await requireOperatorSession();
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
