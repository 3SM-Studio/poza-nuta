
import { useUiText } from "@/i18n/use-ui-text";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleOffIcon,
  ExternalLinkIcon,
  EyeIcon,
  ListMusicIcon,
  QrCodeIcon,
  RadioIcon,
  Share2Icon,
  SettingsIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import Link from "next/link";

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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import type { DashboardEventLifecycleStatus } from "@/lib/dashboard-event-lifecycle";
import { canManageDashboardEventQueue } from "@/lib/dashboard-event-queue";
import {
  canManageDashboardOrganizationEvent,
  canShareDashboardOrganizationEvent,
  type DashboardOrganizationRole,
} from "@/lib/dashboard-organization-access";
import {
  getDashboardOrganizationEventQueuePath,
  getDashboardOrganizationEventSettingsPath,
  getDashboardOrganizationEventSharePath,
} from "@/lib/dashboard-routes";
import { isValidEventSlug } from "@/lib/event-slug";

export type EventOverviewModel = {
  organizationId: string;
  role: DashboardOrganizationRole;
  event: {
    publicId: string;
    lifecycle: DashboardEventLifecycleStatus;
    visibility: "private" | "public";
    publishedAt: Date | null;
    slug: string | null;
    facebookUrl: string | null;
    isActivePublicEvent: boolean;
    songRequestsEnabled: boolean;
    publicQueueEnabled: boolean;
    publicShowSongTitles: boolean;
  };
};

export function EventOverview({ overview }: { overview: EventOverviewModel }) {
  const tx = useUiText();

  const { event, organizationId, role } = overview;
  const queuePath = getDashboardOrganizationEventQueuePath(
    organizationId,
    event.publicId,
  );
  const sharePath = getDashboardOrganizationEventSharePath(
    organizationId,
    event.publicId,
  );
  const settingsPath = getDashboardOrganizationEventSettingsPath(
    organizationId,
    event.publicId,
  );
  const hasValidSlug = Boolean(event.slug && isValidEventSlug(event.slug));
  const isPublished =
    event.visibility === "public" && event.publishedAt !== null;
  const publicPageAvailable = hasValidSlug && isPublished;
  const publicEventPath = publicPageAvailable ? `/events/${event.slug}` : null;
  const canManageSettings = canManageDashboardOrganizationEvent(role);
  const requests = getRequestsPresentation(event);

  return (
    <section
      aria-labelledby="event-overview-heading"
      className="min-w-0"
      data-event-overview
    >
      <h2 id="event-overview-heading" className="sr-only">
        {tx("Przegląd wydarzenia")}</h2>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="min-w-0 lg:col-span-7">
          <CardHeader>
            <CardTitle role="heading" aria-level={3}>
              {tx("Dostęp publiczny")}</CardTitle>
            <CardDescription>
              {tx("Funkcje widoczne dla uczestników i stan publikacji wydarzenia.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup className="grid gap-3 xl:grid-cols-2">
              <StateItem
                description={tx(requests.description)}
                enabled={requests.enabled}
                icon={requests.icon}
                title={tx("Zgłoszenia piosenek")}
                value={tx(requests.value)}
              />
              <StateItem
                description={
                  isPublished ? tx("Wydarzenie jest widoczne w publicznym katalogu.") : tx("Wydarzenie nie jest widoczne w publicznym katalogu.")
                }
                enabled={isPublished}
                icon={EyeIcon}
                title={tx("Katalog wydarzeń")}
                value={isPublished ? tx("Opublikowane") : tx("Nieopublikowane")}
              />
              <StateItem
                description={
                  event.isActivePublicEvent ? tx("Publiczna sesja i kolejka tego wydarzenia są udostępnione uczestnikom.") : tx("Publiczna sesja i kolejka tego wydarzenia nie są udostępnione uczestnikom.")
                }
                enabled={event.isActivePublicEvent}
                icon={RadioIcon}
                title={tx("Sesja publiczna")}
                value={event.isActivePublicEvent ? tx("Aktywna") : tx("Nieaktywna")}
              />
              <StateItem
                description={
                  event.publicQueueEnabled ? tx("Uczestnicy mogą zobaczyć udostępnioną kolejkę.") : tx("Kolejka nie jest udostępniana uczestnikom.")
                }
                enabled={event.publicQueueEnabled}
                icon={ListMusicIcon}
                title={tx("Publiczna kolejka")}
                value={event.publicQueueEnabled ? tx("Widoczna") : tx("Ukryta")}
              />
              <StateItem
                className="xl:col-span-2"
                description={
                  event.publicShowSongTitles ? tx("Publiczna kolejka pokazuje tytuły zgłoszonych utworów.") : tx("Tytuły utworów pozostają ukryte w publicznej kolejce.")
                }
                enabled={event.publicShowSongTitles}
                icon={SlidersHorizontalIcon}
                title={tx("Tytuły utworów")}
                value={event.publicShowSongTitles ? tx("Widoczne") : tx("Ukryte")}
              />
            </ItemGroup>
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-5">
          <CardHeader>
            <CardTitle role="heading" aria-level={3}>
              {tx("Szybkie akcje")}</CardTitle>
            <CardDescription>
              {tx("Przejdź bezpośrednio do obsługi lub podglądu wydarzenia.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2.5">
              <ActionItem
                href={queuePath}
                icon={ListMusicIcon}
                label={
                  canManageDashboardEventQueue(role) ? tx("Zarządzaj kolejką") : tx("Zobacz kolejkę")
                }
              />
              {canShareDashboardOrganizationEvent(role) ? (
                <ActionItem
                  href={sharePath}
                  icon={QrCodeIcon}
                  label={tx("Udostępnij link i QR")}
                />
              ) : null}
              <ActionItem
                href={settingsPath}
                icon={SettingsIcon}
                label={
                  canManageSettings ? tx("Zarządzaj ustawieniami") : tx("Zobacz ustawienia")
                }
              />
              {publicEventPath ? (
                <ActionItem
                  href={publicEventPath}
                  icon={ExternalLinkIcon}
                  label={tx("Otwórz stronę wydarzenia")}
                  external
                />
              ) : null}
              {event.facebookUrl ? (
                <ActionItem
                  href={event.facebookUrl}
                  icon={Share2Icon}
                  label={tx("Otwórz wydarzenie na Facebooku")}
                  external
                />
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-12">
          <CardHeader>
            <CardTitle role="heading" aria-level={3}>
              {tx("Obecność publiczna")}</CardTitle>
            <CardDescription>
              {tx("Adresy i kanały, przez które uczestnicy mogą znaleźć wydarzenie.")}</CardDescription>
            {canManageSettings &&
            (!event.slug || !event.facebookUrl || !publicPageAvailable) ? (
              <CardAction>
                <Button
                  className="min-h-11 sm:min-h-7"
                  variant="ghost"
                  size="sm"
                  asChild
                >
                  <Link href={settingsPath}>{tx("Uzupełnij")}</Link>
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            <dl className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <PresenceDetail
                label={tx("Slug publiczny")}
                value={event.slug ?? tx("Nie ustawiono")}
              />
              <PresenceDetail
                label={tx("Strona wydarzenia")}
                value={
                  publicPageAvailable ? tx("Dostępna publicznie") : hasValidSlug ? tx("Nieopublikowana") : tx("Brak poprawnego adresu")
                }
              />
              <PresenceDetail
                className="sm:col-span-2 lg:col-span-1"
                label={tx("Facebook")}
                value={event.facebookUrl ? tx("Skonfigurowano") : tx("Nie ustawiono")}
              />
            </dl>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function StateItem({
  className,
  description,
  enabled,
  icon: Icon,
  title,
  value,
}: {
  className?: string;
  description: string;
  enabled: boolean;
  icon: LucideIcon;
  title: string;
  value: string;
}) {
  return (
    <Item className={className} role="listitem" variant="muted">
      <ItemMedia variant="icon">
        <Icon aria-hidden="true" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none">{title}</ItemTitle>
        <ItemDescription className="line-clamp-none break-words">
          {description}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="ml-auto self-start">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap">
          {enabled ? (
            <CheckCircle2Icon
              aria-hidden="true"
              className="size-3.5 text-primary"
            />
          ) : (
            <CircleOffIcon
              aria-hidden="true"
              className="size-3.5 text-muted-foreground"
            />
          )}
          {value}
        </span>
      </ItemActions>
    </Item>
  );
}

function ActionItem({
  external = false,
  href,
  icon: Icon,
  label,
}: {
  external?: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  const tx = useUiText();

  const TrailingIcon = external ? ArrowUpRightIcon : ArrowRightIcon;
  const content = (
    <>
      <ItemMedia variant="icon">
        <Icon aria-hidden="true" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none break-words">
          {label}
          {external ? (
            <span className="sr-only">{tx(", otwiera w nowej karcie")}</span>
          ) : null}
        </ItemTitle>
      </ItemContent>
      <ItemActions className="ml-auto">
        <TrailingIcon aria-hidden="true" className="size-4" />
      </ItemActions>
    </>
  );

  return (
    <Item className="min-h-11" asChild variant="outline">
      {external ? (
        <a href={href} rel="noreferrer" target="_blank">
          {content}
        </a>
      ) : (
        <Link href={href}>{content}</Link>
      )}
    </Item>
  );
}

function PresenceDetail({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={`min-w-0 rounded-lg bg-muted/50 p-3 ${className ?? ""}`}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}

function getRequestsPresentation(event: EventOverviewModel["event"]) {
  if (!event.songRequestsEnabled) {
    return {
      description: "Przyjmowanie nowych zgłoszeń zostało wyłączone.",
      enabled: false,
      icon: CircleOffIcon,
      value: "Wyłączone",
    };
  }

  switch (event.lifecycle) {
    case "active":
      return {
        description: "Uczestnicy mogą teraz zgłaszać piosenki.",
        enabled: true,
        icon: RadioIcon,
        value: "Otwarte",
      };
    case "scheduled":
      return {
        description: "Zgłoszenia otworzą się wraz z rozpoczęciem wydarzenia.",
        enabled: true,
        icon: CalendarClockIcon,
        value: "Zaplanowane",
      };
    case "closed":
    case "cancelled":
      return {
        description: "Nowe zgłoszenia nie są już przyjmowane.",
        enabled: false,
        icon: CircleOffIcon,
        value: "Zamknięte",
      };
  }
}
