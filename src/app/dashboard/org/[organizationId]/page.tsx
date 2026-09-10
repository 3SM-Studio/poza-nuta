import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DashboardRuntimeError } from "@/components/operator/dashboard-runtime-error";
import { OrganizationOverviewView } from "@/components/operator/organization-overview-view";
import { getDashboardOrganizationOverviewForAuthUser } from "@/server/operator-api/organization-overview";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import { isTransientInfrastructureError } from "@/server/runtime-diagnostics";

export const metadata: Metadata = {
  title: "Organizacja | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationPageProps = {
  params: Promise<{
    organizationId: string;
  }>;
};

export default async function DashboardOrganizationPage({
  params,
}: OrganizationPageProps) {
  const { organizationId } = await params;
  let overview: Awaited<
    ReturnType<typeof getDashboardOrganizationOverviewForAuthUser>
  >;

  try {
    const session = await requireOperatorSession("dashboard.org");
    overview = await getDashboardOrganizationOverviewForAuthUser(
      session.authUser.id,
      organizationId,
    );
  } catch (error) {
    if (isTransientInfrastructureError(error)) {
      return (
        <DashboardRuntimeError title="Nie udało się wczytać organizacji" />
      );
    }

    throw error;
  }

  if (!overview) {
    notFound();
  }

  return <OrganizationOverviewView overview={overview} />;
}
