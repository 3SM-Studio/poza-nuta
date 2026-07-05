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

import { DashboardRuntimeError } from "../../../../components/operator/dashboard-runtime-error";
import styles from "../../../../components/operator/operator.module.css";
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
    <main className={styles.queuePage}>
      <section className={styles.overviewShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>{overview.organization.name}</h1>
            <p className={styles.eventMeta}>
              ID organizacji: {overview.organization.publicId}
            </p>
          </div>
          <div className={styles.headerActions}>
            <Badge variant="secondary">{formatRole(overview.organization.role)}</Badge>
            <Button variant="outline" asChild>
              <Link href={settingsPath}>Ustawienia</Link>
            </Button>
          </div>
        </header>

        <section className={styles.overviewMetricGrid} aria-label="Statystyki">
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

        <div className={styles.overviewSectionGrid}>
          <Card className={styles.overviewCard}>
            <CardHeader>
              <div>
                <CardDescription>Stan kolejki i wydarzenia</CardDescription>
                <CardTitle>
                  {overview.activeEvent
                    ? overview.activeEvent.name
                    : "Brak aktywnego wydarzenia"}
                </CardTitle>
              </div>
              <CardAction>
                <Badge variant={overview.activeEvent ? "default" : "secondary"}>
                  {overview.activeEvent ? "Aktywne" : "Spoczynek"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              {overview.activeEvent ? (
                <dl className={styles.eventDetails}>
                  <div>
                    <dt>Miejsce</dt>
                    <dd>{overview.activeEvent.venue ?? "Nie ustawiono"}</dd>
                  </div>
                  <div>
                    <dt>Start</dt>
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
                <p className={styles.eventMeta}>
                  Ta organizacja nie ma jeszcze wydarzeń albo nie ma teraz
                  aktywnego wydarzenia.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className={styles.overviewCard}>
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
                <div className={styles.overviewList}>
                  {overview.recentEvents.map((event) => (
                    <div className={styles.overviewRow} key={event.id}>
                      <div>
                        <strong>{event.name}</strong>
                        <p>{event.venue ?? "Bez ustawionego miejsca"}</p>
                      </div>
                      <div className={styles.overviewRowMeta}>
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

        <Card className={styles.overviewCard}>
          <CardHeader>
            <CardDescription>Najczęściej zgłaszane utwory</CardDescription>
            <CardTitle>Najczęściej zgłaszane piosenki</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.partialFailures.topRequestedSongs ? (
              <CardDescription>
                Nie udało się wczytać rankingu. Pozostałe dane są dostępne.
              </CardDescription>
            ) : overview.topRequestedSongs.length > 0 ? (
              <div className={styles.overviewList}>
                {overview.topRequestedSongs.map((song) => (
                  <div className={styles.topSongRow} key={song.songId}>
                    <div>
                      <strong>{song.title}</strong>
                      <p>{song.artist}</p>
                    </div>
                    <div className={styles.topSongMetric}>
                      <span>{song.requestCount}</span>
                      <div
                        className={styles.topSongBar}
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
        <CardTitle className={styles.overviewStatValue}>
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
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
  }).format(value);
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pl-PL").format(value);
}
