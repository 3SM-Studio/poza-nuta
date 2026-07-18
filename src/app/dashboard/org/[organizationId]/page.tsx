import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getDashboardOrganizationEventsPath,
  getDashboardOrganizationSettingsPath,
} from "@/lib/dashboard-routes";
import { formatWarsawDateTime } from "@/lib/warsaw-time";

import { DashboardRuntimeError } from "../../../../components/operator/dashboard-runtime-error";
import { getDashboardOrganizationOverviewForAuthUser } from "../../../../server/operator-api/organization-overview";
import { requireOperatorSession } from "../../../../server/operator-api/supabase-session";
import { isTransientInfrastructureError } from "../../../../server/runtime-diagnostics";

export const metadata: Metadata = {
  title: "Organizacja | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationPageProps = {
  params: Promise<{
    organizationId: string;
  }>;
};

export default async function DashboardOrganizationPage({
  params,
}: OrganizationPageProps) {
  const { organizationId } = await params;
  let overview: Awaited<
    ReturnType<typeof getDashboardOrganizationOverviewForAuthUser>
  >;

  try {
    const session = await requireOperatorSession("dashboard.org");
    overview = await getDashboardOrganizationOverviewForAuthUser(
      session.authUser.id,
      organizationId,
    );
  } catch (error) {
    if (isTransientInfrastructureError(error)) {
      return (
        <DashboardRuntimeError title="Nie udało się wczytać organizacji" />
      );
    }

    throw error;
  }

  if (!overview) {
    notFound();
  }

  const settingsPath = getDashboardOrganizationSettingsPath(
    overview.organization.publicId,
  );
  const eventsPath = getDashboardOrganizationEventsPath(
    overview.organization.publicId,
  );
  const maxTopSongRequests = Math.max(
    ...overview.topRequestedSongs.map((song) => song.requestCount),
    1,
  );

  return (
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section className={"mx-auto w-full min-w-0 max-w-[72rem]"}>
        <header className={"mb-4 flex min-w-0 flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight lg:[&_h1]:text-3xl"}>
          <div>
            <h1>{overview.organization.name}</h1>
            <p className={"mt-1.5 text-sm text-muted-foreground"}>
              ID organizacji: {overview.organization.publicId}
            </p>
          </div>
          <div className={"flex min-w-0 flex-wrap items-center gap-2 sm:justify-end"}>
            <Badge variant="secondary">{formatRole(overview.organization.role)}</Badge>
            <Button variant="outline" asChild>
              <Link href={settingsPath}>Ustawienia</Link>
            </Button>
          </div>
        </header>

        {overview.partialFailures.counts ? (
          <p className={"mt-1.5 text-sm text-muted-foreground"}>
            Nie udało się chwilowo wczytać statystyk. Pozostałe sekcje są
            dostępne.
          </p>
        ) : null}

        <section className={"mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3"} aria-label="Statystyki">
          <StatCard label="Aktywne eventy" value={overview.stats.activeEvents} />
          <StatCard label="Wszystkie eventy" value={overview.stats.totalEvents} />
          <StatCard label="Requesty dzisiaj" value={overview.stats.requestsToday} />
          <StatCard
            label="Requesty 7 dni"
            value={overview.stats.requestsLastSevenDays}
          />
          <StatCard label="Oczekujące" value={overview.stats.pendingRequests} />
          <StatCard
            label="Zaakceptowane"
            value={overview.stats.acceptedRequests}
          />
          <StatCard label="Wykonane" value={overview.stats.performedRequests} />
          <StatCard label="Członkowie" value={overview.stats.members} />
          <StatCard
            label="Utwory w globalnym katalogu"
            value={overview.stats.catalogSongs}
          />
        </section>

        <div className={"grid grid-cols-1 gap-4 lg:grid-cols-2"}>
          <Card className={"mb-4"}>
            <CardHeader>
              <div>
                <CardDescription>Stan kolejki i wydarzenia</CardDescription>
                <CardTitle>
                  {overview.partialFailures.activeEvent
                    ? "Status wydarzenia chwilowo niedostępny"
                    : overview.activeEvent
                      ? overview.activeEvent.name
                      : "Brak aktywnego wydarzenia"}
                </CardTitle>
              </div>
              <CardAction>
                <Badge variant={overview.activeEvent ? "default" : "secondary"}>
                  {overview.partialFailures.activeEvent
                    ? "Niedostępne"
                    : overview.activeEvent
                      ? "Aktywne"
                      : "Spoczynek"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              {overview.partialFailures.activeEvent ? (
                <p className={"mt-1.5 text-sm text-muted-foreground"}>
                  Nie udało się wczytać stanu aktywnego wydarzenia. Pozostałe
                  dane są dostępne.
                </p>
              ) : overview.activeEvent ? (
                <dl className={"grid grid-cols-1 gap-3 sm:grid-cols-2 [&_div]:rounded-md [&_div]:bg-muted/40 [&_div]:p-3 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-sm [&_dd]:font-semibold"}>
                  <div>
                    <dt>Miejsce</dt>
                    <dd>{overview.activeEvent.venue ?? "Nie ustawiono"}</dd>
                  </div>
                  <div>
                    <dt>Start (czas polski)</dt>
                    <dd>{formatDateTime(overview.activeEvent.startsAt)}</dd>
                  </div>
                  <div>
                    <dt>Publiczna kolejka</dt>
                    <dd>
                      {overview.activeEvent.publicQueueEnabled
                        ? "Włączona"
                        : "Wyłączona"}
                    </dd>
                  </div>
                  <div>
                    <dt>Oczekujące zgłoszenia</dt>
                    <dd>{overview.stats.pendingRequests}</dd>
                  </div>
                </dl>
              ) : (
                <p className={"mt-1.5 text-sm text-muted-foreground"}>
                  Ta organizacja nie ma jeszcze wydarzeń albo nie ma teraz
                  aktywnego wydarzenia.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className={"mb-4"}>
            <CardHeader>
              <div>
                <CardDescription>Ostatnie wydarzenia</CardDescription>
                <CardTitle>Ostatnie eventy</CardTitle>
              </div>
              <CardAction>
                <Button variant="outline" size="sm" asChild>
                  <Link href={eventsPath}>Zobacz eventy</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {overview.partialFailures.recentEvents ? (
                <CardDescription>
                  Nie udało się wczytać tej sekcji. Pozostałe dane są dostępne.
                </CardDescription>
              ) : overview.recentEvents.length > 0 ? (
                <div className={"grid gap-3"}>
                  {overview.recentEvents.map((event) => (
                    <div className={"grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-muted/40 p-3 [&_strong]:block [&_strong]:text-sm [&_p]:mt-1 [&_p]:text-sm [&_p]:text-muted-foreground"} key={event.id}>
                      <div>
                        <strong>{event.name}</strong>
                        <p>{event.venue ?? "Bez ustawionego miejsca"}</p>
                      </div>
                      <div className={"flex flex-col items-end gap-1 whitespace-nowrap text-right text-xs text-muted-foreground"}>
                        <Badge variant={getStatusBadgeVariant(event.status)}>
                          {formatEventStatus(event.status)}
                        </Badge>
                        <span>{formatDate(event.startsAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <CardDescription>Brak wydarzeń.</CardDescription>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className={"mb-4"}>
          <CardHeader>
            <CardDescription>
              Najczęściej zgłaszane utwory - ostatnie 30 dni
            </CardDescription>
            <CardTitle>Najczęściej zgłaszane piosenki</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.partialFailures.topRequestedSongs ? (
              <CardDescription>
                Nie udało się wczytać rankingu. Pozostałe dane są dostępne.
              </CardDescription>
            ) : overview.topRequestedSongs.length > 0 ? (
              <div className={"grid gap-3"}>
                {overview.topRequestedSongs.map((song) => (
                  <div className={"grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-muted/40 p-3 [&_strong]:block [&_strong]:text-sm [&_p]:mt-1 [&_p]:text-sm [&_p]:text-muted-foreground"} key={song.songId}>
                    <div>
                      <strong>{song.title}</strong>
                      <p>{song.artist}</p>
                    </div>
                    <div className={"grid min-w-24 justify-items-end gap-1.5 font-semibold text-muted-foreground"}>
                      <span>{song.requestCount}</span>
                      <div
                        className={"h-1.5 min-w-2 max-w-24 rounded-full bg-primary"}
                        style={{
                          width: `${Math.max(
                            (song.requestCount / maxTopSongRequests) * 100,
                            6,
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <CardDescription>
                Brak requestów, więc nie ma jeszcze rankingu piosenek.
              </CardDescription>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className={"text-2xl font-semibold leading-none"}>
          {formatNumber(value)}
        </CardTitle>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function formatRole(role: string) {
  switch (role) {
    case "owner":
      return "Właściciel";
    case "manager":
      return "Menedżer";
    case "operator":
      return "Operator";
    case "viewer":
      return "Podgląd";
    default:
      return role;
  }
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

function formatDate(value: Date) {
  return formatWarsawDateTime(value, {
    dateStyle: "medium",
  });
}

function formatDateTime(value: Date) {
  return formatWarsawDateTime(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pl-PL").format(value);
}
