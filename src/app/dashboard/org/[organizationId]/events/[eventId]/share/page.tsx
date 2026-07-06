import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EventSharePanel } from "@/components/operator/event-share-panel";
import type { EventShareActionState } from "@/components/operator/event-share-panel";
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
  getDashboardOrganizationEventSharePath,
} from "@/lib/dashboard-routes";
import { formatWarsawDateTime } from "@/lib/warsaw-time";
import { OperatorApiError } from "@/server/operator-api/errors";
import {
  canShareDashboardOrganizationEvent,
  generateDashboardOrganizationEventShareLinkForAuthUser,
  getDashboardOrganizationEventSessionLinkForAuthUser,
} from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import { validateEventId } from "@/server/operator-api/validation";

export const metadata: Metadata = {
  title: "Udostępnij wydarzenie | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationEventSharePageProps = {
  params: Promise<{
    organizationId: string;
    eventId: string;
  }>;
};

export default async function OrganizationEventSharePage({
  params,
}: OrganizationEventSharePageProps) {
  const { organizationId, eventId } = await params;
  const eventIdValidation = validateEventId(eventId);

  if (!eventIdValidation.success) {
    notFound();
  }

  const session = await requireOperatorSession();
  const result = await getDashboardOrganizationEventSessionLinkForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    eventId: eventIdValidation.data,
  });

  if (!result || !canShareDashboardOrganizationEvent(result.organization.role)) {
    notFound();
  }

  const lifecycleStatus = getDashboardEventLifecycleStatus(
    result.event,
    new Date(),
  );
  const eventPath = getDashboardOrganizationEventPath(
    result.organization.publicId,
    result.event.id,
  );
  const queuePath = getDashboardOrganizationEventQueuePath(
    result.organization.publicId,
    result.event.id,
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
                Link i QR dla gości konkretnego wydarzenia. To pomocniczy link
                sesji, nie globalny panel administracyjny.
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
              </dl>
            </CardContent>
          </Card>

          <EventSharePanel
            activeLink={
              result.sessionLink
                ? {
                    createdAt: result.sessionLink.createdAt.toISOString(),
                    lastUsedAt:
                      result.sessionLink.lastUsedAt?.toISOString() ?? null,
                    useCount: result.sessionLink.useCount,
                  }
                : null
            }
            canGenerate={canShareDashboardOrganizationEvent(
              result.organization.role,
            )}
            isClosed={
              lifecycleStatus === "closed" || lifecycleStatus === "cancelled"
            }
            action={generateShareLink.bind(
              null,
              result.organization.publicId,
              result.event.id,
            )}
          />
        </div>
      </section>
    </main>
  );
}

async function generateShareLink(
  organizationId: string,
  eventId: number,
  _state: EventShareActionState,
  _formData: FormData,
): Promise<EventShareActionState> {
  "use server";

  void _state;
  void _formData;

  const session = await requireOperatorSession();

  try {
    const result =
      await generateDashboardOrganizationEventShareLinkForAuthUser({
        authUserId: session.authUser.id,
        organizationId,
        eventId,
      });
    const sharePath = getDashboardOrganizationEventSharePath(
      result.organization.publicId,
      result.event.id,
    );

    revalidatePath(sharePath);

    return {
      success: true,
      message:
        "Link sesji został wygenerowany. Poprzedni aktywny link, jeśli istniał, został unieważniony.",
      sessionUrl: await buildSessionUrl(result.sessionPath),
    };
  } catch (error) {
    if (error instanceof OperatorApiError) {
      if (error.status === 403) {
        return {
          success: false,
          message: "Nie masz uprawnień do generowania linku sesji.",
          sessionUrl: null,
        };
      }

      if (error.status === 404) {
        return {
          success: false,
          message: "Nie znaleziono wydarzenia albo organizacji.",
          sessionUrl: null,
        };
      }
    }

    throw error;
  }
}

async function buildSessionUrl(sessionPath: string) {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");

  if (!host) {
    return sessionPath;
  }

  const protocol =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${protocol}://${host}${sessionPath}`;
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
