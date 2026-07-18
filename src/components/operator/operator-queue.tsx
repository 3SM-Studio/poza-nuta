"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
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

import { shouldWarnEventClosingSoon } from "../../lib/event-lifecycle";
import {
  extendDashboardEvent,
  formatDuration,
  getOperatorQueue,
  OperatorClientError,
  type SongSource,
  type OperatorQueueAction,
  type OperatorQueueItem,
  type OperatorQueueResponse,
  type OperatorRequestStatus,
  runOperatorQueueAction,
} from "./api";
import { useDashboardQueueRealtime } from "./use-dashboard-queue-realtime";

const queueSections: Array<{
  status: OperatorRequestStatus;
  title: string;
  wide?: boolean;
}> = [
  { status: "now", title: "Teraz śpiewa", wide: true },
  { status: "pending", title: "Oczekujące" },
  { status: "approved", title: "Zatwierdzone" },
  { status: "done", title: "Zakończone" },
  { status: "skipped", title: "Pominięte" },
  { status: "rejected", title: "Odrzucone", wide: true },
];

const statusLabels: Record<OperatorRequestStatus, string> = {
  pending: "Oczekujące",
  approved: "Zatwierdzone",
  now: "Teraz śpiewa",
  done: "Zakończone",
  skipped: "Pominięte",
  rejected: "Odrzucone",
};

const availableActions: Partial<
  Record<
    OperatorRequestStatus,
    Array<{
      action: OperatorQueueAction;
      label: string;
      destructive?: boolean;
    }>
  >
> = {
  pending: [
    { action: "approve", label: "Zatwierdź" },
    { action: "reject", label: "Odrzuć", destructive: true },
  ],
  approved: [
    { action: "start", label: "Rozpocznij" },
    { action: "skip", label: "Pomiń" },
  ],
  now: [
    { action: "done", label: "Zakończ" },
    { action: "skip", label: "Pomiń" },
  ],
};

export function OperatorQueuePanel() {
  const router = useRouter();
  const [queueData, setQueueData] = useState<OperatorQueueResponse | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [eventAction, setEventAction] = useState<"extend-1" | "extend-2" | null>(
    null,
  );
  const [closingWarningDismissed, setClosingWarningDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuthenticationError = useCallback(
    (caughtError: unknown) => {
      if (
        caughtError instanceof OperatorClientError &&
        caughtError.status === 401
      ) {
        router.replace("/sign-in");
        router.refresh();
        return true;
      }

      return false;
    },
    [router],
  );

  const loadQueue = useCallback(
    async (showRefreshState = true) => {
      if (showRefreshState) {
        setIsRefreshing(true);
      }
      setError(null);

      try {
        const response = await getOperatorQueue();
        setQueueData(response);
      } catch (caughtError) {
        if (!handleAuthenticationError(caughtError)) {
          setError(getClientErrorMessage(caughtError));
        }
      } finally {
        if (showRefreshState) {
          setIsRefreshing(false);
        }
      }
    },
    [handleAuthenticationError],
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        await loadQueue(false);
      } catch (caughtError) {
        if (active && !handleAuthenticationError(caughtError)) {
          setError(getClientErrorMessage(caughtError));
        }
      } finally {
        if (active) {
          setIsInitialLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [handleAuthenticationError, loadQueue]);

  const handleRealtimeInvalidate = useCallback(async () => {
    await loadQueue(false);
  }, [loadQueue]);

  useDashboardQueueRealtime(queueData?.event.id, handleRealtimeInvalidate);

  async function handleAction(
    requestId: number,
    action: OperatorQueueAction,
  ) {
    const actionKey = `${requestId}:${action}`;
    setActiveAction(actionKey);
    setError(null);

    try {
      await runOperatorQueueAction(requestId, action);
      await loadQueue(false);
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        setError(getClientErrorMessage(caughtError));
      }
    } finally {
      setActiveAction(null);
    }
  }

  async function handleExtendEvent(hours: 1 | 2) {
    setEventAction(`extend-${hours}`);
    setError(null);

    try {
      await extendDashboardEvent(hours);
      await loadQueue(false);
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        setError(getClientErrorMessage(caughtError));
      }
    } finally {
      setEventAction(null);
    }
  }

  if (isInitialLoading) {
    return (
      <div className={"px-4 py-16 text-center text-muted-foreground"} role="status">
        Ładowanie kolejki…
      </div>
    );
  }

  const warningNow = new Date();

  return (
    <div className={"mx-auto w-full min-w-0 max-w-[92rem]"}>
      <header className={"mb-4 flex min-w-0 flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight lg:[&_h1]:text-3xl"}>
        <div>
          <h1>Dashboard kolejki</h1>
          {queueData ? (
            <p className={"mt-1.5 text-sm text-muted-foreground"}>
              {queueData.event.name}
              {queueData.event.venue ? ` · ${queueData.event.venue}` : ""}
            </p>
          ) : null}
        </div>

        <div className={"flex min-w-0 flex-wrap items-center gap-2 sm:justify-end"}>
          <Button
            variant="outline"
            type="button"
            onClick={() => void loadQueue()}
            disabled={isRefreshing || activeAction !== null || eventAction !== null}
          >
            {isRefreshing ? "Odświeżanie…" : "Odśwież"}
          </Button>
        </div>
      </header>

      {error ? (
        <Alert className={"mb-4"} variant="destructive">
          <AlertTitle>Nie udało się wykonać operacji</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {queueData &&
      !closingWarningDismissed &&
      shouldWarnEventClosingSoon(queueData.event.autoCloseAt, warningNow) ? (
        <Alert className={"mb-4"}>
          <AlertTitle>Event zakończy się za mniej niż 30 minut.</AlertTitle>
          <AlertDescription>
            <div className={"flex flex-wrap gap-2"}>
              <Button
                type="button"
                onClick={() => void handleExtendEvent(1)}
                disabled={eventAction !== null || activeAction !== null}
              >
                {eventAction === "extend-1"
                  ? "Przedłużanie…"
                  : "Przedłuż +1h"}
              </Button>
              <Button
                type="button"
                onClick={() => void handleExtendEvent(2)}
                disabled={eventAction !== null || activeAction !== null}
              >
                {eventAction === "extend-2"
                  ? "Przedłużanie…"
                  : "Przedłuż +2h"}
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={() => setClosingWarningDismissed(true)}
                disabled={eventAction !== null}
              >
                Ukryj ostrzeżenie
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {queueData ? (
        <div className={"grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2"}>
          {queueSections.map((section) => (
            <QueueSection
              key={section.status}
              title={section.title}
              items={queueData.queue[section.status]}
              wide={section.wide}
              activeAction={activeAction}
              actionsDisabled={
                isRefreshing || eventAction !== null
              }
              onAction={handleAction}
            />
          ))}
        </div>
      ) : (
        <div className={"px-4 py-16 text-center text-muted-foreground"}>
          Nie udało się wczytać kolejki.
        </div>
      )}
    </div>
  );
}

type QueueSectionProps = {
  title: string;
  items: OperatorQueueItem[];
  wide?: boolean;
  activeAction: string | null;
  actionsDisabled: boolean;
  onAction: (requestId: number, action: OperatorQueueAction) => Promise<void>;
};

function QueueSection({
  title,
  items,
  wide,
  activeAction,
  actionsDisabled,
  onAction,
}: QueueSectionProps) {
  return (
    <Card className={wide ? "lg:col-span-2" : undefined}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Badge variant="secondary" aria-label={`${items.length} zgłoszeń`}>
            {items.length}
          </Badge>
        </CardAction>
      </CardHeader>

      {items.length > 0 ? (
        <CardContent className={"grid p-0"}>
          {items.map((item) => (
            <RequestRow
              key={item.id}
              item={item}
              activeAction={activeAction}
              actionsDisabled={actionsDisabled}
              onAction={onAction}
            />
          ))}
        </CardContent>
      ) : (
        <CardContent>
          <CardDescription>Brak zgłoszeń.</CardDescription>
        </CardContent>
      )}
    </Card>
  );
}

type RequestRowProps = {
  item: OperatorQueueItem;
  activeAction: string | null;
  actionsDisabled: boolean;
  onAction: (requestId: number, action: OperatorQueueAction) => Promise<void>;
};

function RequestRow({
  item,
  activeAction,
  actionsDisabled,
  onAction,
}: RequestRowProps) {
  const duration = formatDuration(item.song.durationSeconds);
  const actions = availableActions[item.status] ?? [];
  const sourceLabel = formatDashboardSongSource(item.song.source);

  return (
    <article className={"grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-[minmax(12rem,1fr)_auto] [&+&]:border-t [&+&]:border-border"}>
      <div className={"min-w-0"}>
        <div className={"flex flex-wrap items-center gap-2 [&_strong]:text-base"}>
          <strong>{item.displayName || item.singerName}</strong>
          <Badge variant={getStatusBadgeVariant(item.status)}>
            {statusLabels[item.status]}
          </Badge>
        </div>
        <div className={"mt-2 flex flex-wrap items-center gap-2"}>
          <p className={"m-0 text-sm font-semibold leading-snug"}>{item.song.title}</p>
          <Badge
            className={"max-w-full"}
            variant="outline"
            aria-label={`Źródło piosenki: ${sourceLabel}`}
          >
            {sourceLabel}
          </Badge>
        </div>
        <p className={"mt-0.5 text-sm leading-snug text-muted-foreground"}>{item.song.artist}</p>
        {item.note ? <p className={"mt-2 text-sm leading-relaxed text-muted-foreground"}>Notatka: {item.note}</p> : null}
      </div>

      <div className={"flex flex-row flex-wrap gap-1 text-xs text-muted-foreground sm:flex-col sm:items-end sm:whitespace-nowrap"}>
        <span>Pozycja: {item.position > 0 ? item.position : "—"}</span>
        {duration ? <span>Czas: {duration}</span> : null}
      </div>

      {actions.length > 0 ? (
        <div className={"col-span-full flex flex-wrap gap-2"}>
          {actions.map(({ action, label, destructive }) => {
            const actionKey = `${item.id}:${action}`;
            const isActive = activeAction === actionKey;

            return (
              <Button
                key={action}
                size="sm"
                variant={destructive ? "destructive" : "default"}
                type="button"
                onClick={() => void onAction(item.id, action)}
                disabled={actionsDisabled || activeAction !== null}
              >
                {isActive ? "Zapisywanie…" : label}
              </Button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function formatDashboardSongSource(source: SongSource) {
  const labels = {
    ising: "iSing",
    karafun: "KaraFun",
    manual: "Ręcznie",
  } as const satisfies Record<SongSource, string>;

  return labels[source];
}

function getStatusBadgeVariant(
  status: OperatorRequestStatus,
): "default" | "secondary" | "destructive" {
  if (status === "rejected") {
    return "destructive";
  }

  if (status === "approved" || status === "now" || status === "done") {
    return "default";
  }

  return "secondary";
}

function getClientErrorMessage(error: unknown) {
  return error instanceof OperatorClientError
    ? error.message
    : "Nie udało się wykonać operacji. Spróbuj ponownie.";
}
