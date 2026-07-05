import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EventQueuePanel } from "@/components/operator/event-queue-panel";
import styles from "@/components/operator/operator.module.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getDashboardEventLifecycleStatus,
  type DashboardEventLifecycleStatus,
} from "@/lib/dashboard-event-lifecycle";
import { getDashboardOrganizationEventPath } from "@/lib/dashboard-routes";
import { formatWarsawDateTime } from "@/lib/warsaw-time";
import { getDashboardOrganizationEventQueueForAuthUser } from "@/server/operator-api/event-queue";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import { validateEventId } from "@/server/operator-api/validation";

export const metadata: Metadata = {
  title: "Kolejka wydarzenia | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationEventQueuePageProps = {
  params: Promise<{
    organizationId: string;
    eventId: string;
  }>;
};

export default async function OrganizationEventQueuePage({
  params,
}: OrganizationEventQueuePageProps) {
  const { organizationId, eventId } = await params;
  const eventIdValidation = validateEventId(eventId);

  if (!eventIdValidation.success) {
    notFound();
  }

  const session = await requireOperatorSession();
  const result = await getDashboardOrganizationEventQueueForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    eventId: eventIdValidation.data,
  });

  if (!result) {
    notFound();
  }

  const eventPath = getDashboardOrganizationEventPath(
    result.organization.publicId,
    result.event.id,
  );
  const lifecycleStatus = getDashboardEventLifecycleStatus(
    result.event,
    new Date(),
  );

  return (
    <main className={styles.queuePage}>
      <section className={styles.organizationShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Kolejka wydarzenia</h1>
            <p className={styles.eventMeta}>
              {result.event.name}
              {result.event.venue ? ` · ${result.event.venue}` : ""}
            </p>
          </div>
          <div className={styles.headerActions}>
            <Badge variant={getStatusBadgeVariant(lifecycleStatus)}>
              {formatLifecycleStatus(lifecycleStatus)}
            </Badge>
            <Button variant="outline" asChild>
              <Link href={eventPath}>Powrót do wydarzenia</Link>
            </Button>
          </div>
        </header>

        <div className={styles.organizationList}>
          <Card>
            <CardHeader>
              <CardTitle>{result.event.name}</CardTitle>
              <CardDescription>
                Zgłoszenia przypisane wyłącznie do tego wydarzenia.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className={styles.eventDetails}>
                <div>
                  <dt>Miejsce</dt>
                  <dd>{result.event.venue ?? "Nie ustawiono"}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{formatLifecycleStatus(lifecycleStatus)}</dd>
                </div>
                <div>
                  <dt>Start (czas polski)</dt>
                  <dd>{formatDateTime(result.event.startsAt)}</dd>
                </div>
                <div>
                  <dt>Czas zamknięcia (czas polski)</dt>
                  <dd>{formatDateTime(result.event.autoCloseAt)}</dd>
                </div>
                <div>
                  <dt>Publiczna kolejka</dt>
                  <dd>
                    {result.event.publicQueueEnabled
                      ? "Włączona"
                      : "Wyłączona"}
                  </dd>
                </div>
                <div>
                  <dt>Uprawnienia</dt>
                  <dd>
                    {result.canManage
                      ? "Zarządzanie kolejką"
                      : "Tylko podgląd"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <EventQueuePanel
            organizationId={result.organization.publicId}
            eventId={result.event.id}
            canManage={result.canManage}
            initialItems={result.items.map((item) => ({
              ...item,
              createdAt: item.createdAt.toISOString(),
              updatedAt: item.updatedAt.toISOString(),
              startedAt: item.startedAt?.toISOString() ?? null,
              completedAt: item.completedAt?.toISOString() ?? null,
            }))}
          />
        </div>
      </section>
    </main>
  );
}

function getStatusBadgeVariant(status: DashboardEventLifecycleStatus) {
  return status === "active"
    ? "default"
    : status === "closed" || status === "cancelled"
      ? "secondary"
      : "outline";
}

function formatLifecycleStatus(status: DashboardEventLifecycleStatus) {
  switch (status) {
    case "active":
      return "Aktywne";
    case "cancelled":
      return "Anulowane";
    case "closed":
      return "Zamknięte";
    case "scheduled":
      return "Zaplanowane";
  }
}

function formatDateTime(date: Date | null) {
  if (!date) {
    return "Brak terminu";
  }

  return formatWarsawDateTime(date);
}
