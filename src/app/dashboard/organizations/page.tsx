import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getDashboardNewOrganizationPath,
  getDashboardOrganizationPath,
} from "@/lib/dashboard-routes";

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
            <h1>Twoje organizacje</h1>
            <p className={styles.eventMeta}>
              Wybierz organizację, którą chcesz teraz zarządzać.
            </p>
          </div>
          {organizations.length > 0 ? (
            <Button asChild>
              <Link href={getDashboardNewOrganizationPath()}>
                Create organization
              </Link>
            </Button>
          ) : null}
        </header>

        {organizations.length > 0 ? (
          <div className={styles.organizationList}>
            {organizations.map((organization) => (
              <Card key={organization.id}>
                <CardHeader>
                  <CardTitle>{organization.name}</CardTitle>
                  <CardDescription className={styles.breakValue}>
                    public_id: {organization.publicId}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Badge variant="secondary">{formatRole(organization.role)}</Badge>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" asChild>
                    <Link
                      href={getDashboardOrganizationPath(organization.publicId)}
                    >
                      Open
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <Card className={styles.emptyStateCard}>
            <CardHeader>
              <CardTitle>Nie masz jeszcze organizacji</CardTitle>
              <CardDescription>
                Utwórz organizację, żeby grupować eventy karaoke, zespół i
                ustawienia.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild>
                <Link href={getDashboardNewOrganizationPath()}>
                  Create organization
                </Link>
              </Button>
            </CardFooter>
          </Card>
        )}
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
