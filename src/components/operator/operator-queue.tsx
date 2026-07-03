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
  type OperatorQueueAction,
  type OperatorQueueItem,
  type OperatorQueueResponse,
  type OperatorRequestStatus,
  runOperatorQueueAction,
} from "./api";
import styles from "./operator.module.css";
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
      <div className={styles.loadingScreen} role="status">
        Ładowanie kolejki…
      </div>
    );
  }

  const warningNow = new Date();

  return (
    <div className={styles.queueShell}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Dashboard kolejki</h1>
          {queueData ? (
            <p className={styles.eventMeta}>
              {queueData.event.name}
              {queueData.event.venue ? ` · ${queueData.event.venue}` : ""}
            </p>
          ) : null}
        </div>

        <div className={styles.headerActions}>
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
        <Alert className={styles.pageError} variant="destructive">
          <AlertTitle>Nie udało się wykonać operacji</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {queueData &&
      !closingWarningDismissed &&
      shouldWarnEventClosingSoon(queueData.event.autoCloseAt, warningNow) ? (
        <Alert className={styles.eventWarning}>
          <AlertTitle>Event zakończy się za mniej niż 30 minut.</AlertTitle>
          <AlertDescription>
            <div className={styles.warningActions}>
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
        <div className={styles.queueGrid}>
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
        <div className={styles.emptyPage}>
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
    <Card className={wide ? styles.wideSection : undefined}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Badge variant="secondary" aria-label={`${items.length} zgłoszeń`}>
            {items.length}
          </Badge>
        </CardAction>
      </CardHeader>

      {items.length > 0 ? (
        <CardContent className={styles.requestList}>
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

  return (
    <article className={styles.requestRow}>
      <div className={styles.requestMain}>
        <div className={styles.requestHeading}>
          <strong>{item.displayName || item.singerName}</strong>
          <Badge variant={getStatusBadgeVariant(item.status)}>
            {statusLabels[item.status]}
          </Badge>
        </div>
        <p className={styles.songTitle}>{item.song.title}</p>
        <p className={styles.songArtist}>{item.song.artist}</p>
        {item.note ? <p className={styles.note}>Notatka: {item.note}</p> : null}
      </div>

      <div className={styles.requestMeta}>
        <span>Pozycja: {item.position > 0 ? item.position : "—"}</span>
        {item.song.source ? <span>Źródło: {item.song.source}</span> : null}
        {duration ? <span>Czas: {duration}</span> : null}
      </div>

      {actions.length > 0 ? (
        <div className={styles.rowActions}>
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
