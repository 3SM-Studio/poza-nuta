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

import { listDashboardOrganizationMembersForAuthUser } from "../../../../../server/operator-api/organizations";
import { requireOperatorSession } from "../../../../../server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Zespół organizacji | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationTeamPageProps = {
  params: Promise<{
    organizationId: string;
  }>;
};

export default async function OrganizationTeamPage({
  params,
}: OrganizationTeamPageProps) {
  const { organizationId } = await params;
  const session = await requireOperatorSession();
  const result = await listDashboardOrganizationMembersForAuthUser(
    session.authUser.id,
    organizationId,
  );

  if (!result) {
    notFound();
  }

  return (
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section className={"mx-auto w-full min-w-0 max-w-[72rem]"}>
        <header className={"mb-4 flex min-w-0 flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight lg:[&_h1]:text-3xl"}>
          <div>
            <h1>Zespół</h1>
            <p className={"mt-1.5 text-sm text-muted-foreground"}>{result.organization.name}</p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Członkowie organizacji</CardTitle>
            <CardDescription>
              Widok tylko do odczytu. Zaproszenia i zmiana ról nie są częścią
              tego etapu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result.members.length > 0 ? (
              <div className={"grid gap-3"}>
                {result.members.map((member) => (
                  <article className={"grid min-w-0 grid-cols-1 gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center [&_h2]:text-base [&_h2]:font-semibold [&_p]:mt-1 [&_p]:break-all [&_p]:text-sm [&_p]:text-muted-foreground"} key={member.id}>
                    <div>
                      <h2>{member.operatorName}</h2>
                      <p>
                        {member.authUserId
                          ? `Auth user: ${member.authUserId}`
                          : "Brak powiązanego użytkownika Auth"}
                      </p>
                    </div>
                    <div className={"flex flex-wrap gap-2 sm:justify-end"}>
                      <Badge variant="secondary">{formatRole(member.role)}</Badge>
                      <Badge variant={member.active ? "default" : "destructive"}>
                        {member.active ? "Aktywny" : "Nieaktywny"}
                      </Badge>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className={"mt-1.5 text-sm text-muted-foreground"}>
                Ta organizacja nie ma przypisanych członków.
              </p>
            )}
          </CardContent>
        </Card>
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
