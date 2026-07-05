import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getDashboardOrganizationEventsPath,
  getDashboardOrganizationSettingsPath,
  getDashboardOrganizationTeamPath,
} from "@/lib/dashboard-routes";
import { resolveDashboardOrganizationAccess } from "@/lib/dashboard-organization-access";

import styles from "../../../../components/operator/operator.module.css";
import { getDashboardOrganizationForAuthUser } from "../../../../server/operator-api/organizations";
import { requireOperatorSession } from "../../../../server/operator-api/supabase-session";

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
  const session = await requireOperatorSession();
  const organization = await getDashboardOrganizationForAuthUser(
    session.authUser.id,
    organizationId,
  );
  const access = resolveDashboardOrganizationAccess(organization);

  if (!access.allowed) {
    notFound();
  }

  return (
    <main className={styles.queuePage}>
      <section className={styles.organizationShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>{access.organization.name}</h1>
            <p className={styles.eventMeta}>ID: {access.organization.publicId}</p>
          </div>
          <Badge variant="secondary">{formatRole(access.organization.role)}</Badge>
        </header>

        <div className={styles.organizationGrid}>
          <Card>
            <CardHeader>
              <CardTitle>Eventy</CardTitle>
              <CardDescription>
                Lista eventów przypisanych do tej organizacji.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                className={styles.inlineLink}
                href={getDashboardOrganizationEventsPath(
                  access.organization.publicId,
                )}
              >
                Zobacz eventy
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Zespół</CardTitle>
              <CardDescription>
                Podgląd członków przypisanych do organizacji.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                className={styles.inlineLink}
                href={getDashboardOrganizationTeamPath(
                  access.organization.publicId,
                )}
              >
                Zobacz zespół
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ustawienia ogólne</CardTitle>
              <CardDescription>
                Podgląd podstawowych danych workspace’u.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                className={styles.inlineLink}
                href={getDashboardOrganizationSettingsPath(
                  access.organization.publicId,
                )}
              >
                Otwórz ustawienia
              </Link>
            </CardContent>
          </Card>
        </div>
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
