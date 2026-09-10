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
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section className={"mx-auto w-full min-w-0 max-w-[72rem]"}>
        <header className={"mb-4 flex min-w-0 flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight lg:[&_h1]:text-3xl"}>
          <div>
            <h1>Eventy</h1>
            <p className={"mt-1.5 text-sm text-muted-foreground"}>{result.organization.name}</p>
          </div>
          {canCreateEvent ? (
            <Button asChild>
              <Link href={newEventPath}>Utwórz wydarzenie</Link>
            </Button>
          ) : null}
        </header>

        {result.events.length > 0 ? (
          <div className={"grid min-w-0 gap-4"}>
            {result.events.map((event) => (
              <Card key={event.id}>
                <CardHeader>
                  <CardTitle>{event.name}</CardTitle>
                  <CardDescription>
                    {event.venue ?? "Bez ustawionego miejsca"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className={"grid grid-cols-1 gap-3 sm:grid-cols-2 [&_div]:rounded-md [&_div]:bg-muted/40 [&_div]:p-3 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-sm [&_dd]:font-semibold"}>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        <Badge variant={getStatusBadgeVariant(event.effectiveStatus)}>
                          {formatEventStatus(event.effectiveStatus)}
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
                    <div>
                      <dt>Katalog wydarzeń</dt>
                      <dd>{event.visibility === "public" ? "Opublikowany" : "Prywatny"}</dd>
                    </div>
                  </dl>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" asChild>
                    <Link
                      href={getDashboardOrganizationEventPath(
                        result.organization.publicId,
                        event.publicId,
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
      return "Aktywne";
    case "scheduled":
      return "Zaplanowane";
    case "cancelled":
      return "Anulowane";
    case "closed":
      return "Zamknięte";
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
