import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EventSessionAccessPanel } from "@/components/operator/event-session-access-panel";
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
import {
  getDashboardOrganizationEventPath,
  getDashboardOrganizationEventQueuePath,
} from "@/lib/dashboard-routes";
import { formatWarsawDateTime } from "@/lib/warsaw-time";
import { tryBuildCanonicalSiteUrl } from "@/server/canonical-site-origin";
import {
  canShareDashboardOrganizationEvent,
  getDashboardOrganizationEventSessionAccessForAuthUser,
} from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import { validateEventId } from "@/server/operator-api/validation";

export const metadata: Metadata = {
  title: "Udostępnij wydarzenie | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationEventSharePageProps = {
  params: Promise<{ organizationId: string; eventId: string }>;
};

export default async function OrganizationEventSharePage({
  params,
}: OrganizationEventSharePageProps) {
  const { organizationId, eventId } = await params;
  const eventIdValidation = validateEventId(eventId);
  if (!eventIdValidation.success) notFound();

  const session = await requireOperatorSession();
  const result = await getDashboardOrganizationEventSessionAccessForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    eventId: eventIdValidation.data,
  });

  if (!result || !canShareDashboardOrganizationEvent(result.organization.role)) {
    notFound();
  }

  const lifecycleStatus = getDashboardEventLifecycleStatus(result.event);
  const eventPath = getDashboardOrganizationEventPath(
    result.organization.publicId,
    result.event.id,
  );
  const queuePath = getDashboardOrganizationEventQueuePath(
    result.organization.publicId,
    result.event.id,
  );
  const sessionUrl = tryBuildCanonicalSiteUrl(
    `/session/${result.event.sessionCode}`,
  );

  return (
    <main className={styles.queuePage}>
      <section className={styles.organizationShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Udostępnij wydarzenie</h1>
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
              <Link href={queuePath}>Kolejka</Link>
            </Button>
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
                Kod i QR prowadzą wyłącznie do kanonicznej sesji wydarzenia.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className={styles.eventDetails}>
                <div>
                  <dt>Status</dt>
                  <dd>{formatLifecycleStatus(lifecycleStatus)}</dd>
                </div>
                <div>
                  <dt>Start (czas polski)</dt>
                  <dd>{formatWarsawDateTime(result.event.startsAt)}</dd>
                </div>
                <div>
                  <dt>Czas zamknięcia (czas polski)</dt>
                  <dd>{formatDateTime(result.event.autoCloseAt)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <EventSessionAccessPanel
            sessionCode={result.event.sessionCode}
            sessionUrl={sessionUrl}
            isClosed={
              lifecycleStatus === "closed" || lifecycleStatus === "cancelled"
            }
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
  return date ? formatWarsawDateTime(date) : "Brak terminu";
}
