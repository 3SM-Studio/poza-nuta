import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

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
  getDashboardOrganizationEventPath,
  getDashboardOrganizationNewEventPath,
} from "@/lib/dashboard-routes";
import { formatWarsawDateTime } from "@/lib/warsaw-time";

import styles from "../../../../../components/operator/operator.module.css";
import {
  canCreateDashboardOrganizationEvent,
  listDashboardOrganizationEventsForAuthUser,
} from "../../../../../server/operator-api/organizations";
import { requireOperatorSession } from "../../../../../server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Eventy organizacji | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationEventsPageProps = {
  params: Promise<{
    organizationId: string;
  }>;
};

export default async function OrganizationEventsPage({
  params,
}: OrganizationEventsPageProps) {
  const { organizationId } = await params;
  const session = await requireOperatorSession();
  const result = await listDashboardOrganizationEventsForAuthUser(
    session.authUser.id,
    organizationId,
  );

  if (!result) {
    notFound();
  }

  const canCreateEvent = canCreateDashboardOrganizationEvent(
    result.organization.role,
  );
  const newEventPath = getDashboardOrganizationNewEventPath(
    result.organization.publicId,
  );

  return (
    <main className={styles.queuePage}>
      <section className={styles.organizationShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Eventy</h1>
            <p className={styles.eventMeta}>{result.organization.name}</p>
          </div>
          {canCreateEvent ? (
            <Button asChild>
              <Link href={newEventPath}>Utwórz wydarzenie</Link>
            </Button>
          ) : null}
        </header>

        {result.events.length > 0 ? (
          <div className={styles.organizationList}>
            {result.events.map((event) => (
              <Card key={event.id}>
                <CardHeader>
                  <CardTitle>{event.name}</CardTitle>
                  <CardDescription>
                    {event.venue ?? "Bez ustawionego miejsca"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className={styles.eventDetails}>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        <Badge variant={getStatusBadgeVariant(event.status)}>
                          {formatEventStatus(event.status)}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt>Start (czas polski)</dt>
                      <dd>{formatDate(event.startsAt)}</dd>
                    </div>
                    <div>
                      <dt>Czas zamknięcia (czas polski)</dt>
                      <dd>{formatDate(event.autoCloseAt)}</dd>
                    </div>
                    <div>
                      <dt>Publiczna kolejka</dt>
                      <dd>{event.publicQueueEnabled ? "Włączona" : "Wyłączona"}</dd>
                    </div>
                    <div>
                      <dt>Publiczny event</dt>
                      <dd>{event.isActivePublicEvent ? "Tak" : "Nie"}</dd>
                    </div>
                  </dl>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" asChild>
                    <Link
                      href={getDashboardOrganizationEventPath(
                        result.organization.publicId,
                        event.id,
                      )}
                    >
                      Otwórz
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Brak eventów</CardTitle>
              <CardDescription>
                Ta organizacja nie ma jeszcze eventów w bazie.
              </CardDescription>
            </CardHeader>
            {canCreateEvent ? (
              <CardFooter>
                <Button asChild>
                  <Link href={newEventPath}>Utwórz wydarzenie</Link>
                </Button>
              </CardFooter>
            ) : null}
          </Card>
        )}
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

function formatDate(date: Date | null) {
  if (!date) {
    return "Brak terminu";
  }

  return formatWarsawDateTime(date);
}
