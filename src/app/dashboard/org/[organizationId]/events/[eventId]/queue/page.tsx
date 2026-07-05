import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

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
import { getDashboardEventLifecycleStatus } from "@/lib/dashboard-event-lifecycle";
import { getDashboardOrganizationEventPath } from "@/lib/dashboard-routes";
import { getDashboardOrganizationEventForAuthUser } from "@/server/operator-api/organizations";
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
  const result = await getDashboardOrganizationEventForAuthUser({
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
            <p className={styles.eventMeta}>{result.event.name}</p>
          </div>
          <div className={styles.headerActions}>
            <Badge variant={getStatusBadgeVariant(lifecycleStatus)}>
              {formatLifecycleStatus(lifecycleStatus)}
            </Badge>
            <Button variant="outline" asChild>
              <Link href={eventPath}>Wróć do wydarzenia</Link>
            </Button>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>{result.event.name}</CardTitle>
            <CardDescription>
              Zarządzanie kolejką zostanie rozbudowane w kolejnym etapie.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className={styles.eventMeta}>
              Ten widok jest przygotowany pod event-specific queue. Obecny
              bezpieczny panel kolejki pozostaje w dotychczasowym miejscu.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function getStatusBadgeVariant(status: string) {
  return status === "active"
    ? "default"
    : status === "closed" || status === "cancelled"
      ? "secondary"
      : "outline";
}

function formatLifecycleStatus(status: string) {
  switch (status) {
    case "active":
      return "Aktywne";
    case "cancelled":
      return "Anulowane";
    case "closed":
      return "Zamknięte";
    case "scheduled":
      return "Zaplanowane";
    default:
      return status;
  }
}
