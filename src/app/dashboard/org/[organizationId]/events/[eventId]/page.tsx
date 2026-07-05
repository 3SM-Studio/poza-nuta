import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboardOrganizationEventsPath } from "@/lib/dashboard-routes";
import styles from "@/components/operator/operator.module.css";
import { getDashboardOrganizationEventForAuthUser } from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import { validateEventId } from "@/server/operator-api/validation";

export const metadata: Metadata = {
  title: "Wydarzenie | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationEventDetailPageProps = {
  params: Promise<{
    organizationId: string;
    eventId: string;
  }>;
};

export default async function OrganizationEventDetailPage({
  params,
}: OrganizationEventDetailPageProps) {
  const { organizationId, eventId } = await params;
  const eventIdValidation = validateEventId(eventId);

  if (!eventIdValidation.success) {
    notFound();
  }

  const session = await requireOperatorSession();
  const result = await getDashboardOrganizationEventForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    eventId: eventIdValidation.data,
  });

  if (!result) {
    notFound();
  }

  const eventsPath = getDashboardOrganizationEventsPath(
    result.organization.publicId,
  );

  return (
    <main className={styles.queuePage}>
      <section className={styles.organizationShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>{result.event.name}</h1>
            <p className={styles.eventMeta}>{result.organization.name}</p>
          </div>
          <div className={styles.headerActions}>
            <Badge variant={getStatusBadgeVariant(result.event.status)}>
              {formatEventStatus(result.event.status)}
            </Badge>
            <Button variant="outline" asChild>
              <Link href={eventsPath}>Wróć do eventów</Link>
            </Button>
          </div>
        </header>

        <div className={styles.organizationList}>
          <Card>
            <CardHeader>
              <CardTitle>Szczegóły wydarzenia</CardTitle>
              <CardDescription>
                To jest minimalny panel eventu. Zarządzanie kolejką zostanie
                podłączone osobno.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className={styles.eventDetails}>
                <div>
                  <dt>Status</dt>
                  <dd>{formatEventStatus(result.event.status)}</dd>
                </div>
                <div>
                  <dt>Start</dt>
                  <dd>{formatDateTime(result.event.startsAt)}</dd>
                </div>
                <div>
                  <dt>Czas zamknięcia</dt>
                  <dd>{formatDateTime(result.event.autoCloseAt)}</dd>
                </div>
                <div>
                  <dt>Publiczny event</dt>
                  <dd>{result.event.isActivePublicEvent ? "Tak" : "Nie"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Link sesji</CardTitle>
              <CardDescription>
                Link sesji zostanie dodany w kolejnym etapie.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {result.event.facebookUrl ? (
                <p className={styles.eventMeta}>
                  Facebook:{" "}
                  <a
                    className={styles.inlineLink}
                    href={result.event.facebookUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Otwórz wydarzenie na Facebooku
                  </a>
                </p>
              ) : (
                <p className={styles.eventMeta}>
                  Facebook URL nie został ustawiony.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}

function getStatusBadgeVariant(status: string) {
  return status === "active"
    ? "default"
    : status === "closed"
      ? "secondary"
      : "outline";
}

function formatEventStatus(status: string) {
  switch (status) {
    case "active":
      return "Aktywny";
    case "closed":
      return "Zamknięty";
    case "draft":
      return "Szkic";
    default:
      return status;
  }
}

function formatDateTime(date: Date | null) {
  if (!date) {
    return "Brak terminu";
  }

  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
