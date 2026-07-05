import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { resolveDashboardOrganizationAccess } from "@/lib/dashboard-organization-access";

import styles from "../../../../../../components/operator/operator.module.css";
import { getDashboardOrganizationForAuthUser } from "../../../../../../server/operator-api/organizations";
import { requireOperatorSession } from "../../../../../../server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Ustawienia organizacji | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationGeneralSettingsPageProps = {
  params: Promise<{
    orgHandle: string;
  }>;
};

export default async function OrganizationGeneralSettingsPage({
  params,
}: OrganizationGeneralSettingsPageProps) {
  const { orgHandle } = await params;
  const session = await requireOperatorSession();
  const organization = await getDashboardOrganizationForAuthUser(
    session.authUser.id,
    orgHandle,
  );
  const access = resolveDashboardOrganizationAccess(organization);

  if (!access.allowed) {
    notFound();
  }

  const { organization: accessibleOrganization } = access;

  return (
    <main className={styles.queuePage}>
      <section className={styles.organizationShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Ustawienia ogólne</h1>
            <p className={styles.eventMeta}>{accessibleOrganization.name}</p>
          </div>
          <Badge
            variant={accessibleOrganization.active ? "secondary" : "destructive"}
          >
            {accessibleOrganization.active ? "Aktywna" : "Nieaktywna"}
          </Badge>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Dane organizacji</CardTitle>
            <CardDescription>
              Widok tylko do odczytu. Edycja ustawień organizacji nie jest
              częścią tego etapu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className={styles.eventDetails}>
              <div>
                <dt>Nazwa</dt>
                <dd>{accessibleOrganization.name}</dd>
              </div>
              <div>
                <dt>Handle</dt>
                <dd>{accessibleOrganization.handle}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  {accessibleOrganization.active ? "Aktywna" : "Nieaktywna"}
                </dd>
              </div>
              <div>
                <dt>Rola</dt>
                <dd>{formatRole(accessibleOrganization.role)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function formatRole(role: string) {
  switch (role) {
    case "owner":
      return "Owner";
    case "manager":
      return "Manager";
    case "operator":
      return "Operator";
    case "viewer":
      return "Viewer";
    default:
      return role;
  }
}
