import { redirect } from "next/navigation";

import { getDashboardOrganizationSettingsPath } from "@/lib/dashboard-routes";

type OrganizationGeneralSettingsPageProps = {
  params: Promise<{
    organizationId: string;
  }>;
};

export default async function OrganizationGeneralSettingsRedirectPage({
  params,
}: OrganizationGeneralSettingsPageProps) {
  const { organizationId } = await params;

  redirect(getDashboardOrganizationSettingsPath(organizationId));
}
