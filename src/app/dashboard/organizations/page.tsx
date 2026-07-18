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
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section className={"mx-auto w-full min-w-0 max-w-[72rem]"}>
        <header className={"mb-4 flex min-w-0 flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight lg:[&_h1]:text-3xl"}>
          <div>
            <h1>Twoje organizacje</h1>
            <p className={"mt-1.5 text-sm text-muted-foreground"}>
              Wybierz organizację, którą chcesz teraz zarządzać.
            </p>
          </div>
          {organizations.length > 0 ? (
            <Button asChild>
              <Link href={getDashboardNewOrganizationPath()}>
                Utwórz organizację
              </Link>
            </Button>
          ) : null}
        </header>

        {organizations.length > 0 ? (
          <div className={"grid min-w-0 gap-4"}>
            {organizations.map((organization) => (
              <Card key={organization.id}>
                <CardHeader>
                  <CardTitle>{organization.name}</CardTitle>
                  <CardDescription className={"min-w-0 break-all [overflow-wrap:anywhere]"}>
                    ID organizacji: {organization.publicId}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Badge variant="secondary">
                    Rola: {formatRole(organization.role)}
                  </Badge>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" asChild>
                    <Link
                      href={getDashboardOrganizationPath(organization.publicId)}
                    >
                      Otwórz
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <Card className={"max-w-[38rem]"}>
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
                  Utwórz organizację
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
      return "Właściciel";
    case "manager":
      return "Menedżer";
    case "operator":
      return "Operator";
    case "viewer":
      return "Podgląd";
    default:
      return role;
  }
}
