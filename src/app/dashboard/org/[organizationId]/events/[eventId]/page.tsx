import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  areDashboardEventRequestsOpen,
  getDashboardEventLifecycleStatus,
} from "@/lib/dashboard-event-lifecycle";
import { getDashboardOrganizationEventPath } from "@/lib/dashboard-routes";
import { formatWarsawDateTime } from "@/lib/warsaw-time";
import { getDashboardOrganizationEventSessionAccessForAuthUser } from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import { validateDashboardEventIdentifier } from "@/server/operator-api/validation";

export const metadata: Metadata = {
  title: "Wydarzenie | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default async function OrganizationEventDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string; eventId: string }>;
}) {
  const { organizationId, eventId } = await params;
  const eventIdValidation = validateDashboardEventIdentifier(eventId);
  if (!eventIdValidation.success) notFound();

  const session = await requireOperatorSession();
  const result = await getDashboardOrganizationEventSessionAccessForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    eventId: eventIdValidation.data,
  });
  if (!result) notFound();

  if (eventId !== result.event.publicId) {
    redirect(
      getDashboardOrganizationEventPath(
        result.organization.publicId,
        result.event.publicId,
      ),
    );
  }

  const lifecycleStatus = getDashboardEventLifecycleStatus(result.event);
  const requestsOpen = areDashboardEventRequestsOpen(result.event);

  return (
    <main className="min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground">
      <section className="mx-auto w-full min-w-0 max-w-[72rem]">
        <header className="mb-4 flex min-w-0 flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight lg:[&_h1]:text-3xl">
          <div className="min-w-0">
            <h1 className="truncate">{result.event.name}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {result.organization.name}
            </p>
          </div>
          <Badge variant={getLifecycleStatusBadgeVariant(lifecycleStatus)}>
            {formatLifecycleStatus(lifecycleStatus)}
          </Badge>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Szczegóły wydarzenia</CardTitle>
            <CardDescription>
              Bieżący stan i publiczna konfiguracja wydarzenia.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&_div]:rounded-md [&_div]:bg-muted/40 [&_div]:p-3 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-sm [&_dd]:font-semibold">
              <Detail label="Status" value={formatLifecycleStatus(lifecycleStatus)} />
              <Detail label="Zgłoszenia" value={requestsOpen ? "Otwarte" : "Zamknięte"} />
              <Detail label="Start (czas polski)" value={formatDateTime(result.event.startsAt)} />
              <Detail label="Czas zamknięcia (czas polski)" value={formatDateTime(result.event.autoCloseAt)} />
              <Detail label="Publiczne wydarzenie" value={result.event.isActivePublicEvent ? "Tak" : "Nie"} />
              <Detail label="Katalog wydarzeń" value={result.event.visibility === "public" ? "Opublikowane" : "Prywatne"} />
              <div>
                <dt>Publiczny URL</dt>
                <dd>
                  {result.event.slug ? (
                    <Link className="font-semibold text-primary underline-offset-4 hover:underline" href={`/events/${result.event.slug}`}>
                      /events/{result.event.slug}
                    </Link>
                  ) : (
                    "Nie ustawiono"
                  )}
                </dd>
              </div>
              <Detail label="Publiczna kolejka" value={result.event.publicQueueEnabled ? "Włączona" : "Wyłączona"} />
              <div>
                <dt>Facebook</dt>
                <dd>
                  {result.event.facebookUrl ? (
                    <a className="font-semibold text-primary underline-offset-4 hover:underline" href={result.event.facebookUrl} rel="noreferrer" target="_blank">
                      Otwórz wydarzenie
                    </a>
                  ) : (
                    "Nie ustawiono"
                  )}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function getLifecycleStatusBadgeVariant(status: string) {
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

function formatDateTime(date: Date | null) {
  return date ? formatWarsawDateTime(date) : "Brak terminu";
}
