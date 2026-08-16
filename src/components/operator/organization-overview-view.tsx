import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CircleAlert,
  ListMusic,
  MapPin,
  Music2,
  Plus,
  Settings2,
  TicketCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  getDashboardOrganizationEventsPath,
  getDashboardOrganizationNewEventPath,
  getDashboardOrganizationSettingsPath,
} from "@/lib/dashboard-routes";
import { formatWarsawDateTime } from "@/lib/warsaw-time";
import type { DashboardOrganizationOverview } from "@/server/operator-api/organization-overview";

export function OrganizationOverviewView({
  overview,
}: {
  overview: DashboardOrganizationOverview;
}) {
  const settingsPath = getDashboardOrganizationSettingsPath(
    overview.organization.publicId,
  );
  const eventsPath = getDashboardOrganizationEventsPath(
    overview.organization.publicId,
  );
  const newEventPath = getDashboardOrganizationNewEventPath(
    overview.organization.publicId,
  );
  const canManageEvents = ["owner", "manager"].includes(
    overview.organization.role,
  );
  const hasPartialFailures = Object.values(overview.partialFailures).some(
    Boolean,
  );
  const maxTopSongRequests = Math.max(
    ...overview.topRequestedSongs.map((song) => song.requestCount),
    1,
  );

  return (
    <main
      className="min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"
      data-organization-overview
    >
      <section className="mx-auto w-full min-w-0 max-w-[80rem]">
        <header className="mb-6 flex min-w-0 flex-col gap-4 py-1 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-semibold leading-tight tracking-tight lg:text-3xl">
              {overview.organization.name}
            </h1>
            <p className="mt-1.5 break-all text-sm text-muted-foreground">
              ID organizacji: {overview.organization.publicId}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
            <Badge variant="secondary">
              <UsersRound data-icon="inline-start" />
              {formatRole(overview.organization.role)}
            </Badge>
            <Button variant="outline" asChild>
              <Link href={settingsPath}>
                <Settings2 data-icon="inline-start" />
                Ustawienia
              </Link>
            </Button>
            {canManageEvents ? (
              <Button asChild>
                <Link href={newEventPath}>
                  <Plus data-icon="inline-start" />
                  Nowe wydarzenie
                </Link>
              </Button>
            ) : null}
          </div>
        </header>

        {hasPartialFailures ? (
          <Alert className="mb-4">
            <CircleAlert />
            <AlertTitle>Część danych jest chwilowo niedostępna</AlertTitle>
            <AlertDescription>
              Możesz nadal korzystać z dostępnych sekcji. Brakujące dane nie są
              zastępowane wartościami przykładowymi.
            </AlertDescription>
          </Alert>
        ) : null}

        <section
          className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-12"
          aria-label="Przegląd organizacji"
        >
          <ActiveEventCard
            canManageEvents={canManageEvents}
            eventsPath={eventsPath}
            newEventPath={newEventPath}
            overview={overview}
          />
          <QueueAttentionCard overview={overview} />
          <RecentEventsCard
            canManageEvents={canManageEvents}
            eventsPath={eventsPath}
            newEventPath={newEventPath}
            overview={overview}
          />
          <SongRankingCard
            maxRequests={maxTopSongRequests}
            overview={overview}
          />
          <OrganizationSummaryCard
            canManageOrganization={overview.organization.role === "owner"}
            overview={overview}
            settingsPath={settingsPath}
          />
        </section>
      </section>
    </main>
  );
}

function ActiveEventCard({
  canManageEvents,
  eventsPath,
  newEventPath,
  overview,
}: {
  canManageEvents: boolean;
  eventsPath: string;
  newEventPath: string;
  overview: DashboardOrganizationOverview;
}) {
  const { activeEvent } = overview;

  return (
    <Card className="lg:col-span-2 xl:col-span-8">
      <CardHeader>
        <CardTitle
          className="min-w-0 break-words [overflow-wrap:anywhere]"
          role="heading"
          aria-level={2}
        >
          {overview.partialFailures.activeEvent
            ? "Nie udało się wczytać aktywnego wydarzenia"
            : activeEvent
              ? activeEvent.name
              : "Brak aktywnego wydarzenia"}
        </CardTitle>
        <CardDescription>
          {overview.partialFailures.activeEvent
            ? "Nie możemy teraz potwierdzić, które wydarzenie jest aktywne."
            : activeEvent
              ? "Najważniejsze informacje potrzebne przed przejściem do obsługi wydarzenia."
              : "Utwórz wydarzenie, aby przyjmować zgłoszenia i prowadzić kolejkę."}
        </CardDescription>
        <CardAction>
          <Badge
            variant={
              overview.partialFailures.activeEvent
                ? "outline"
                : activeEvent
                  ? "default"
                  : "secondary"
            }
          >
            {overview.partialFailures.activeEvent ? (
              <CircleAlert data-icon="inline-start" />
            ) : activeEvent ? (
              <TicketCheck data-icon="inline-start" />
            ) : (
              <CalendarDays data-icon="inline-start" />
            )}
            {overview.partialFailures.activeEvent
              ? "Dane częściowe"
              : activeEvent
                ? "Aktywne"
                : "Brak wydarzenia"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {overview.partialFailures.activeEvent ? (
          <SectionUnavailable message="Nie udało się potwierdzić stanu aktywnego wydarzenia. Lista wydarzeń pozostaje dostępna." />
        ) : activeEvent ? (
          <ItemGroup className="grid gap-3 sm:grid-cols-2">
            <InfoItem
              description={activeEvent.venue ?? "Nie ustawiono miejsca"}
              icon={MapPin}
              title="Miejsce"
            />
            <InfoItem
              description={formatDateTime(activeEvent.startsAt)}
              icon={CalendarClock}
              title="Start — czas polski"
            />
            <InfoItem
              description={
                activeEvent.publicQueueEnabled ? "Włączona" : "Wyłączona"
              }
              icon={ListMusic}
              title="Publiczna kolejka"
            />
            <InfoItem
              description={
                overview.partialFailures.counts
                  ? "Chwilowo niedostępne"
                  : formatNumber(overview.stats.pendingRequests)
              }
              icon={UsersRound}
              title="Oczekujące zgłoszenia"
            />
          </ItemGroup>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarPlus />
              </EmptyMedia>
              <EmptyTitle>Rozpocznij od pierwszego wydarzenia</EmptyTitle>
              <EmptyDescription>
                {canManageEvents
                  ? "Ustaw termin i widoczność, a następnie udostępnij uczestnikom kod sesji."
                  : "Tworzenie wydarzeń wymaga roli właściciela lub menedżera organizacji."}
              </EmptyDescription>
            </EmptyHeader>
            {canManageEvents ? (
              <EmptyContent>
                <Button asChild>
                  <Link href={newEventPath}>
                    <Plus data-icon="inline-start" />
                    Utwórz wydarzenie
                  </Link>
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {overview.partialFailures.counts
            ? "Liczba wydarzeń chwilowo niedostępna"
            : `Wszystkie wydarzenia: ${formatNumber(overview.stats.totalEvents)}`}
        </span>
        <Button variant="outline" size="sm" asChild>
          <Link href={eventsPath}>
            Zobacz wydarzenia
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function QueueAttentionCard({
  overview,
}: {
  overview: DashboardOrganizationOverview;
}) {
  return (
    <Card className="lg:col-span-1 xl:col-span-4">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Kolejka i zgłoszenia
        </CardTitle>
        <CardDescription>
          Najważniejsze liczby do szybkiej oceny obciążenia operatora.
        </CardDescription>
        <CardAction>
          <Badge
            variant={
              overview.partialFailures.counts
                ? "outline"
                : overview.stats.pendingRequests > 0
                  ? "default"
                  : "secondary"
            }
          >
            {overview.partialFailures.counts
              ? "Dane częściowe"
              : overview.stats.pendingRequests > 0
                ? `${formatNumber(overview.stats.pendingRequests)} oczekuje`
                : "Brak oczekujących"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {overview.partialFailures.counts ? (
          <SectionUnavailable message="Statystyki kolejki nie odpowiedziały na czas. Spróbuj odświeżyć widok za chwilę." />
        ) : (
          <ItemGroup className="grid grid-cols-2 gap-3">
            <MetricItem
              label="Dzisiaj"
              value={overview.stats.requestsToday}
            />
            <MetricItem
              label="Oczekujące"
              value={overview.stats.pendingRequests}
            />
            <MetricItem
              label="Zaakceptowane"
              value={overview.stats.acceptedRequests}
            />
            <MetricItem
              label="Wykonane"
              value={overview.stats.performedRequests}
            />
          </ItemGroup>
        )}
      </CardContent>
      <CardFooter>
        <span className="text-sm text-muted-foreground">
          {overview.partialFailures.counts
            ? "Statystyki z 7 dni chwilowo niedostępne"
            : `Ostatnie 7 dni: ${formatNumber(overview.stats.requestsLastSevenDays)} zgłoszeń`}
        </span>
      </CardFooter>
    </Card>
  );
}

function RecentEventsCard({
  canManageEvents,
  eventsPath,
  newEventPath,
  overview,
}: {
  canManageEvents: boolean;
  eventsPath: string;
  newEventPath: string;
  overview: DashboardOrganizationOverview;
}) {
  return (
    <Card className="lg:col-span-1 xl:col-span-7">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Ostatnie wydarzenia
        </CardTitle>
        <CardDescription>
          Status, miejsce i termin ostatnio obsługiwanych wydarzeń.
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" asChild>
            <Link href={eventsPath}>Pełna lista</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {overview.partialFailures.recentEvents ? (
          <SectionUnavailable message="Nie udało się wczytać ostatnich wydarzeń. Pozostałe sekcje są dostępne." />
        ) : overview.recentEvents.length > 0 ? (
          <ItemGroup>
            {overview.recentEvents.map((event) => (
              <Item key={event.id} role="listitem" variant="muted">
                <ItemMedia variant="icon">
                  <CalendarDays />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="line-clamp-2 break-words">
                    {event.name}
                  </ItemTitle>
                  <ItemDescription className="line-clamp-2 break-words">
                    {event.venue ?? "Bez ustawionego miejsca"}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto flex-col items-end">
                  <Badge variant={getStatusBadgeVariant(event.status)}>
                    {formatEventStatus(event.status)}
                  </Badge>
                  <time
                    className="text-xs whitespace-nowrap text-muted-foreground"
                    dateTime={event.startsAt.toISOString()}
                  >
                    {formatDate(event.startsAt)}
                  </time>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarPlus />
              </EmptyMedia>
              <EmptyTitle>Nie ma jeszcze wydarzeń</EmptyTitle>
              <EmptyDescription>
                Pierwsze wydarzenie pojawi się tutaj wraz ze statusem i datą.
              </EmptyDescription>
            </EmptyHeader>
            {canManageEvents ? (
              <EmptyContent>
                <Button variant="outline" asChild>
                  <Link href={newEventPath}>Utwórz pierwsze wydarzenie</Link>
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function SongRankingCard({
  maxRequests,
  overview,
}: {
  maxRequests: number;
  overview: DashboardOrganizationOverview;
}) {
  return (
    <Card className="lg:col-span-2 xl:col-span-5">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Najczęściej zgłaszane piosenki
        </CardTitle>
        <CardDescription>
          Ranking pomaga rozpoznać repertuar najczęściej wybierany przez gości.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {overview.partialFailures.topRequestedSongs ? (
          <SectionUnavailable message="Ranking utworów jest chwilowo niedostępny. Dane wydarzeń nie zostały utracone." />
        ) : overview.topRequestedSongs.length > 0 ? (
          <ItemGroup>
            {overview.topRequestedSongs.map((song) => (
              <Item key={song.songId} role="listitem" variant="muted">
                <ItemMedia variant="icon">
                  <Music2 />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="line-clamp-2 break-words">
                    {song.title}
                  </ItemTitle>
                  <ItemDescription className="line-clamp-2 break-words">
                    {song.artist}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto flex-col items-end gap-1.5">
                  <span className="font-semibold tabular-nums">
                    {formatNumber(song.requestCount)}
                  </span>
                  <div
                    className="h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:w-24"
                    role="progressbar"
                    aria-label={`${song.title}: ${formatNumber(song.requestCount)} zgłoszeń`}
                    aria-valuemax={maxRequests}
                    aria-valuemin={0}
                    aria-valuenow={song.requestCount}
                  >
                    <div
                      className="h-full min-w-1.5 rounded-full bg-primary"
                      style={{
                        width: `${Math.max(
                          (song.requestCount / maxRequests) * 100,
                          6,
                        )}%`,
                      }}
                    />
                  </div>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Music2 />
              </EmptyMedia>
              <EmptyTitle>Brak danych o popularnych utworach</EmptyTitle>
              <EmptyDescription>
                Ranking pojawi się, gdy uczestnicy zaczną wysyłać zgłoszenia.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
      <CardFooter>
        <span className="text-sm text-muted-foreground">
          Dane z ostatnich 30 dni
        </span>
      </CardFooter>
    </Card>
  );
}

function OrganizationSummaryCard({
  canManageOrganization,
  overview,
  settingsPath,
}: {
  canManageOrganization: boolean;
  overview: DashboardOrganizationOverview;
  settingsPath: string;
}) {
  return (
    <Card className="lg:col-span-2 xl:col-span-12">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Organizacja w liczbach
        </CardTitle>
        <CardDescription>
          Najważniejsze informacje o zespole, wydarzeniach i katalogu.
        </CardDescription>
        {canManageOrganization ? (
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              <Link href={settingsPath}>
                <Settings2 data-icon="inline-start" />
                Zarządzaj
              </Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {overview.partialFailures.counts ? (
          <SectionUnavailable message="Nie udało się wczytać liczników organizacji. Ustawienia pozostają dostępne." />
        ) : (
          <ItemGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricItem label="Członkowie" value={overview.stats.members} />
            <MetricItem
              label="Wszystkie wydarzenia"
              value={overview.stats.totalEvents}
            />
            <MetricItem
              label="Aktywne wydarzenia"
              value={overview.stats.activeEvents}
            />
            <MetricItem
              label="Utwory w globalnym katalogu"
              value={overview.stats.catalogSongs}
            />
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  );
}

function InfoItem({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <Item role="listitem" variant="muted">
      <ItemMedia variant="icon">
        <Icon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="line-clamp-2 break-words">
          {description}
        </ItemDescription>
      </ItemContent>
    </Item>
  );
}

function MetricItem({ label, value }: { label: string; value: number }) {
  return (
    <Item role="listitem" variant="muted">
      <ItemContent>
        <span className="text-2xl font-semibold leading-none tabular-nums">
          {formatNumber(value)}
        </span>
        <ItemDescription className="line-clamp-2 break-words">
          {label}
        </ItemDescription>
      </ItemContent>
    </Item>
  );
}

function SectionUnavailable({ message }: { message: string }) {
  return (
    <Alert>
      <CircleAlert />
      <AlertTitle>Dane chwilowo niedostępne</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
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
