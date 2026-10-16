
import { useUiText } from "@/i18n/use-ui-text";
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
import type { DashboardOrganizationOverview } from "@/server/operator-api/organization-overview";

export function OrganizationOverviewView({
  overview,
}: {
  overview: DashboardOrganizationOverview;
}) {
  const tx = useUiText();

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
              {tx("ID organizacji: ")}{overview.organization.publicId}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
            <Badge variant="secondary">
              <UsersRound data-icon="inline-start" />
              {tx(formatRole(overview.organization.role))}
            </Badge>
            <Button variant="outline" asChild>
              <Link href={settingsPath}>
                <Settings2 data-icon="inline-start" />
                {tx("Ustawienia")}</Link>
            </Button>
            {canManageEvents ? (
              <Button asChild>
                <Link href={newEventPath}>
                  <Plus data-icon="inline-start" />
                  {tx("Nowe wydarzenie")}</Link>
              </Button>
            ) : null}
          </div>
        </header>

        {hasPartialFailures ? (
          <Alert className="mb-4">
            <CircleAlert />
            <AlertTitle>{tx("Część danych jest chwilowo niedostępna")}</AlertTitle>
            <AlertDescription>
              {tx("Możesz nadal korzystać z dostępnych sekcji. Brakujące dane nie są zastępowane wartościami przykładowymi.")}</AlertDescription>
          </Alert>
        ) : null}

        <section
          className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-12"
          aria-label={tx("Przegląd organizacji")}
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
  const tx = useUiText();

  const { activeEvent } = overview;

  return (
    <Card className="lg:col-span-2 xl:col-span-8">
      <CardHeader>
        <CardTitle
          className="min-w-0 break-words [overflow-wrap:anywhere]"
          role="heading"
          aria-level={2}
        >
          {overview.partialFailures.activeEvent ? tx("Nie udało się wczytać aktywnego wydarzenia") : activeEvent ? activeEvent.name : tx("Brak aktywnego wydarzenia")}
        </CardTitle>
        <CardDescription>
          {overview.partialFailures.activeEvent ? tx("Nie możemy teraz potwierdzić, które wydarzenie jest aktywne.") : activeEvent ? tx("Najważniejsze informacje potrzebne przed przejściem do obsługi wydarzenia.") : tx("Utwórz wydarzenie, aby przyjmować zgłoszenia i prowadzić kolejkę.")}
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
            {overview.partialFailures.activeEvent ? tx("Dane częściowe") : activeEvent ? tx("Aktywne") : tx("Brak wydarzenia")}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {overview.partialFailures.activeEvent ? (
          <SectionUnavailable message={tx("Nie udało się potwierdzić stanu aktywnego wydarzenia. Lista wydarzeń pozostaje dostępna.")} />
        ) : activeEvent ? (
          <ItemGroup className="grid gap-3 sm:grid-cols-2">
            <InfoItem
              description={activeEvent.venue ?? tx("Nie ustawiono miejsca")}
              icon={MapPin}
              title={tx("Miejsce")}
            />
            <InfoItem
              description={tx.date(activeEvent.startsAt)}
              icon={CalendarClock}
              title={tx("Start — czas polski")}
            />
            <InfoItem
              description={
                activeEvent.publicQueueEnabled ? tx("Włączona") : tx("Wyłączona")
              }
              icon={ListMusic}
              title={tx("Publiczna kolejka")}
            />
            <InfoItem
              description={
                overview.partialFailures.counts ? tx("Chwilowo niedostępne") : tx.number(overview.stats.pendingRequests)
              }
              icon={UsersRound}
              title={tx("Oczekujące zgłoszenia")}
            />
          </ItemGroup>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarPlus />
              </EmptyMedia>
              <EmptyTitle>{tx("Rozpocznij od pierwszego wydarzenia")}</EmptyTitle>
              <EmptyDescription>
                {canManageEvents ? tx("Ustaw termin i widoczność, a następnie udostępnij uczestnikom kod sesji.") : tx("Tworzenie wydarzeń wymaga roli właściciela lub menedżera organizacji.")}
              </EmptyDescription>
            </EmptyHeader>
            {canManageEvents ? (
              <EmptyContent>
                <Button asChild>
                  <Link href={newEventPath}>
                    <Plus data-icon="inline-start" />
                    {tx("Utwórz wydarzenie")}</Link>
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {overview.partialFailures.counts ? tx("Liczba wydarzeń chwilowo niedostępna") : tx("Wszystkie wydarzenia: {v0}", {v0: tx.number(overview.stats.totalEvents)})}
        </span>
        <Button variant="outline" size="sm" asChild>
          <Link href={eventsPath}>
            {tx("Zobacz wydarzenia")}<ArrowRight data-icon="inline-end" />
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
  const tx = useUiText();

  return (
    <Card className="lg:col-span-1 xl:col-span-4">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {tx("Kolejka i zgłoszenia")}</CardTitle>
        <CardDescription>
          {tx("Najważniejsze liczby do szybkiej oceny obciążenia operatora.")}</CardDescription>
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
            {overview.partialFailures.counts ? tx("Dane częściowe") : overview.stats.pendingRequests > 0 ? tx("{v0} oczekuje", {v0: tx.number(overview.stats.pendingRequests)}) : tx("Brak oczekujących")}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {overview.partialFailures.counts ? (
          <SectionUnavailable message={tx("Statystyki kolejki nie odpowiedziały na czas. Spróbuj odświeżyć widok za chwilę.")} />
        ) : (
          <ItemGroup className="grid grid-cols-2 gap-3">
            <MetricItem
              label={tx("Dzisiaj")}
              value={overview.stats.requestsToday}
            />
            <MetricItem
              label={tx("Oczekujące")}
              value={overview.stats.pendingRequests}
            />
            <MetricItem
              label={tx("Zaakceptowane")}
              value={overview.stats.acceptedRequests}
            />
            <MetricItem
              label={tx("Wykonane")}
              value={overview.stats.performedRequests}
            />
          </ItemGroup>
        )}
      </CardContent>
      <CardFooter>
        <span className="text-sm text-muted-foreground">
          {overview.partialFailures.counts ? tx("Statystyki z 7 dni chwilowo niedostępne") : tx("Ostatnie 7 dni: {v0} zgłoszeń", {v0: tx.number(overview.stats.requestsLastSevenDays)})}
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
  const tx = useUiText();

  return (
    <Card className="lg:col-span-1 xl:col-span-7">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {tx("Ostatnie wydarzenia")}</CardTitle>
        <CardDescription>
          {tx("Status, miejsce i termin ostatnio obsługiwanych wydarzeń.")}</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" asChild>
            <Link href={eventsPath}>{tx("Pełna lista")}</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {overview.partialFailures.recentEvents ? (
          <SectionUnavailable message={tx("Nie udało się wczytać ostatnich wydarzeń. Pozostałe sekcje są dostępne.")} />
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
                    {event.venue ?? tx("Bez ustawionego miejsca")}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto flex-col items-end">
                  <Badge variant={getStatusBadgeVariant(event.status)}>
                    {tx(formatEventStatus(event.status))}
                  </Badge>
                  <time
                    className="text-xs whitespace-nowrap text-muted-foreground"
                    dateTime={event.startsAt.toISOString()}
                  >
                    {tx.date(event.startsAt, { dateStyle: "medium" })}
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
              <EmptyTitle>{tx("Nie ma jeszcze wydarzeń")}</EmptyTitle>
              <EmptyDescription>
                {tx("Pierwsze wydarzenie pojawi się tutaj wraz ze statusem i datą.")}</EmptyDescription>
            </EmptyHeader>
            {canManageEvents ? (
              <EmptyContent>
                <Button variant="outline" asChild>
                  <Link href={newEventPath}>{tx("Utwórz pierwsze wydarzenie")}</Link>
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
  const tx = useUiText();

  return (
    <Card className="lg:col-span-2 xl:col-span-5">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {tx("Najczęściej zgłaszane piosenki")}</CardTitle>
        <CardDescription>
          {tx("Ranking pomaga rozpoznać repertuar najczęściej wybierany przez gości.")}</CardDescription>
      </CardHeader>
      <CardContent>
        {overview.partialFailures.topRequestedSongs ? (
          <SectionUnavailable message={tx("Ranking utworów jest chwilowo niedostępny. Dane wydarzeń nie zostały utracone.")} />
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
                    {tx.number(song.requestCount)}
                  </span>
                  <div
                    className="h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:w-24"
                    role="progressbar"
                    aria-label={tx("{v0}: {v1} zgłoszeń", {v0: song.title, v1: tx.number(song.requestCount)})}
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
              <EmptyTitle>{tx("Brak danych o popularnych utworach")}</EmptyTitle>
              <EmptyDescription>
                {tx("Ranking pojawi się, gdy uczestnicy zaczną wysyłać zgłoszenia.")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
      <CardFooter>
        <span className="text-sm text-muted-foreground">
          {tx("Dane z ostatnich 30 dni")}</span>
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
  const tx = useUiText();

  return (
    <Card className="lg:col-span-2 xl:col-span-12">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {tx("Organizacja w liczbach")}</CardTitle>
        <CardDescription>
          {tx("Najważniejsze informacje o zespole, wydarzeniach i katalogu.")}</CardDescription>
        {canManageOrganization ? (
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              <Link href={settingsPath}>
                <Settings2 data-icon="inline-start" />
                {tx("Zarządzaj")}</Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {overview.partialFailures.counts ? (
          <SectionUnavailable message={tx("Nie udało się wczytać liczników organizacji. Ustawienia pozostają dostępne.")} />
        ) : (
          <ItemGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricItem label={tx("Członkowie")} value={overview.stats.members} />
            <MetricItem
              label={tx("Wszystkie wydarzenia")}
              value={overview.stats.totalEvents}
            />
            <MetricItem
              label={tx("Aktywne wydarzenia")}
              value={overview.stats.activeEvents}
            />
            <MetricItem
              label={tx("Utwory w globalnym katalogu")}
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
  const tx = useUiText();
  return (
    <Item role="listitem" variant="muted">
      <ItemContent>
        <span className="text-2xl font-semibold leading-none tabular-nums">
          {tx.number(value)}
        </span>
        <ItemDescription className="line-clamp-2 break-words">
          {label}
        </ItemDescription>
      </ItemContent>
    </Item>
  );
}

function SectionUnavailable({ message }: { message: string }) {
  const tx = useUiText();

  return (
    <Alert>
      <CircleAlert />
      <AlertTitle>{tx("Dane chwilowo niedostępne")}</AlertTitle>
      <AlertDescription>{tx(message)}</AlertDescription>
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
