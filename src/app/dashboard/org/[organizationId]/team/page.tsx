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

import styles from "../../../../../components/operator/operator.module.css";
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
    <main className={styles.queuePage}>
      <section className={styles.organizationShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Zespół</h1>
            <p className={styles.eventMeta}>{result.organization.name}</p>
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
              <div className={styles.memberList}>
                {result.members.map((member) => (
                  <article className={styles.memberRow} key={member.id}>
                    <div>
                      <h2>{member.operatorName}</h2>
                      <p>
                        {member.authUserId
                          ? `Auth user: ${member.authUserId}`
                          : "Brak powiązanego użytkownika Auth"}
                      </p>
                    </div>
                    <div className={styles.memberBadges}>
                      <Badge variant="secondary">{formatRole(member.role)}</Badge>
                      <Badge variant={member.active ? "default" : "destructive"}>
                        {member.active ? "Aktywny" : "Nieaktywny"}
                      </Badge>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className={styles.eventMeta}>
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
