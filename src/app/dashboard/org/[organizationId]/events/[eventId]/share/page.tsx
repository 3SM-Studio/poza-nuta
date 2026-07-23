import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { EventSessionAccessPanel } from "@/components/operator/event-session-access-panel";
import { Badge } from "@/components/ui/badge";
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
import { getDashboardOrganizationEventSharePath } from "@/lib/dashboard-routes";
import { formatWarsawDateTime } from "@/lib/warsaw-time";
import { tryBuildCanonicalSiteUrl } from "@/server/canonical-site-origin";
import {
  canShareDashboardOrganizationEvent,
  getDashboardOrganizationEventSessionAccessForAuthUser,
} from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import { validateDashboardEventIdentifier } from "@/server/operator-api/validation";

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
  const eventIdValidation = validateDashboardEventIdentifier(eventId);
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

  if (eventId !== result.event.publicId) {
    redirect(
      getDashboardOrganizationEventSharePath(
        result.organization.publicId,
        result.event.publicId,
      ),
    );
  }

  const lifecycleStatus = getDashboardEventLifecycleStatus(result.event);
  const sessionUrl = tryBuildCanonicalSiteUrl(
    `/s/${result.event.publicToken}`,
  );

  return (
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section className={"mx-auto w-full min-w-0 max-w-[72rem]"}>
        <header className={"mb-4 flex min-w-0 flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight lg:[&_h1]:text-3xl"}>
          <div>
            <h1>Udostępnij wydarzenie</h1>
            <p className={"mt-1.5 text-sm text-muted-foreground"}>
              {result.event.name}
              {result.event.venue ? ` · ${result.event.venue}` : ""}
            </p>
          </div>
          <Badge variant={getStatusBadgeVariant(lifecycleStatus)}>
            {formatLifecycleStatus(lifecycleStatus)}
          </Badge>
        </header>

        <div className={"grid min-w-0 gap-4"}>
          <Card>
            <CardHeader>
              <CardTitle>{result.event.name}</CardTitle>
              <CardDescription>
                Kod i QR prowadzą wyłącznie do kanonicznej sesji wydarzenia.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className={"grid grid-cols-1 gap-3 sm:grid-cols-2 [&_div]:rounded-md [&_div]:bg-muted/40 [&_div]:p-3 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-sm [&_dd]:font-semibold"}>
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
