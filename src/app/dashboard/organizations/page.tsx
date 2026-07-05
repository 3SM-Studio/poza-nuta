import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboardOrganizationPath } from "@/lib/dashboard-routes";

import styles from "../../../components/operator/operator.module.css";
import { listDashboardOrganizationsForAuthUser } from "../../../server/operator-api/organizations";
import { requireOperatorSession } from "../../../server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Organizacje | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default async function DashboardOrganizationsPage() {
  const session = await requireOperatorSession();
  const organizations = await listDashboardOrganizationsForAuthUser(
    session.authUser.id,
  );

  return (
    <main className={styles.queuePage}>
      <section className={styles.organizationShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Organizacje</h1>
            <p className={styles.eventMeta}>
              Workspace’y przypisane do zalogowanego operatora.
            </p>
          </div>
        </header>

        {organizations.length > 0 ? (
          <div className={styles.organizationGrid}>
            {organizations.map((organization) => (
              <Card key={organization.id}>
                <CardHeader>
                  <CardTitle>{organization.name}</CardTitle>
                  <CardDescription>ID: {organization.publicId}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Badge variant="secondary">{formatRole(organization.role)}</Badge>
                </CardContent>
                <CardFooter>
                  <Link
                    className={styles.inlineLink}
                    href={getDashboardOrganizationPath(organization.publicId)}
                  >
                    Otwórz organizację
                  </Link>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Brak przypisanych organizacji</CardTitle>
              <CardDescription>
                Konto operatora jest aktywne, ale nie ma aktywnego wpisu w
                workspace_members.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
        <p className={styles.eventMeta}>
          <Link className={styles.inlineLink} href="/dashboard/organizations/new">
            Utwórz nową organizację
          </Link>
        </p>
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
