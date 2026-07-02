"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { shouldWarnEventClosingSoon } from "../../lib/event-lifecycle";
import {
  extendDashboardEvent,
  formatDuration,
  getCurrentOperator,
  getOperatorQueue,
  logoutOperator,
  OperatorClientError,
  type OperatorIdentity,
  type OperatorQueueAction,
  type OperatorQueueItem,
  type OperatorQueueResponse,
  type OperatorRequestStatus,
  runOperatorQueueAction,
} from "./api";
import styles from "./operator.module.css";

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
  const [operator, setOperator] = useState<OperatorIdentity | null>(null);
  const [queueData, setQueueData] = useState<OperatorQueueResponse | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [eventAction, setEventAction] = useState<"extend-1" | "extend-2" | null>(
    null,
  );
  const [closingWarningDismissed, setClosingWarningDismissed] = useState(false);
  const [warningNow, setWarningNow] = useState(() => new Date());
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
        const currentOperator = await getCurrentOperator();

        if (!active) {
          return;
        }

        setOperator(currentOperator.operator);
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

  useEffect(() => {
    const interval = window.setInterval(() => {
      setWarningNow(new Date());
    }, 60_000);

    return () => window.clearInterval(interval);
  }, []);

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

  async function handleLogout() {
    setIsLoggingOut(true);
    setError(null);

    try {
      await logoutOperator();
      router.replace("/sign-in");
      router.refresh();
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        setError(getClientErrorMessage(caughtError));
        setIsLoggingOut(false);
      }
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

  return (
    <div className={styles.queueShell}>
      <header className={styles.queueHeader}>
        <div>
          <p className={styles.brand}>Poza Nutą</p>
          <h1>Dashboard kolejki</h1>
          {queueData ? (
            <p className={styles.eventMeta}>
              {queueData.event.name}
              {queueData.event.venue ? ` · ${queueData.event.venue}` : ""}
            </p>
          ) : null}
        </div>

        <div className={styles.headerActions}>
          {operator ? (
            <span className={styles.operatorName}>
              Operator: {operator.name}
            </span>
          ) : null}
          <Link
            className={`${styles.button} ${styles.secondaryButton}`}
            href="/dashboard/settings"
          >
            Ustawienia
          </Link>
          <button
            className={`${styles.button} ${styles.secondaryButton}`}
            type="button"
            onClick={() => void loadQueue()}
            disabled={
              isRefreshing ||
              activeAction !== null ||
              eventAction !== null ||
              isLoggingOut
            }
          >
            {isRefreshing ? "Odświeżanie…" : "Odśwież"}
          </button>
          <button
            className={`${styles.button} ${styles.secondaryButton}`}
            type="button"
            onClick={() => void handleLogout()}
            disabled={
              isLoggingOut || activeAction !== null || eventAction !== null
            }
          >
            {isLoggingOut ? "Wylogowywanie…" : "Wyloguj"}
          </button>
        </div>
      </header>

      {error ? (
        <div className={styles.pageError} role="alert">
          {error}
        </div>
      ) : null}

      {queueData &&
      !closingWarningDismissed &&
      shouldWarnEventClosingSoon(queueData.event.autoCloseAt, warningNow) ? (
        <section className={styles.eventWarning} role="alert">
          <strong>Event zakończy się za mniej niż 30 minut.</strong>
          <div className={styles.warningActions}>
            <button
              className={`${styles.button} ${styles.actionButton}`}
              type="button"
              onClick={() => void handleExtendEvent(1)}
              disabled={eventAction !== null || activeAction !== null}
            >
              {eventAction === "extend-1" ? "Przedłużanie…" : "Przedłuż +1h"}
            </button>
            <button
              className={`${styles.button} ${styles.actionButton}`}
              type="button"
              onClick={() => void handleExtendEvent(2)}
              disabled={eventAction !== null || activeAction !== null}
            >
              {eventAction === "extend-2" ? "Przedłużanie…" : "Przedłuż +2h"}
            </button>
            <button
              className={`${styles.button} ${styles.secondaryButton}`}
              type="button"
              onClick={() => setClosingWarningDismissed(true)}
              disabled={eventAction !== null}
            >
              Zamknij po czasie
            </button>
          </div>
        </section>
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
                isRefreshing || isLoggingOut || eventAction !== null
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
    <section
      className={`${styles.queueSection} ${wide ? styles.wideSection : ""}`}
    >
      <div className={styles.sectionHeader}>
        <h2>{title}</h2>
        <span aria-label={`${items.length} zgłoszeń`}>{items.length}</span>
      </div>

      {items.length > 0 ? (
        <div className={styles.requestList}>
          {items.map((item) => (
            <RequestRow
              key={item.id}
              item={item}
              activeAction={activeAction}
              actionsDisabled={actionsDisabled}
              onAction={onAction}
            />
          ))}
        </div>
      ) : (
        <p className={styles.emptySection}>Brak zgłoszeń.</p>
      )}
    </section>
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
          <span className={`${styles.status} ${styles[item.status]}`}>
            {statusLabels[item.status]}
          </span>
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
              <button
                key={action}
                className={`${styles.button} ${
                  destructive ? styles.dangerButton : styles.actionButton
                }`}
                type="button"
                onClick={() => void onAction(item.id, action)}
                disabled={actionsDisabled || activeAction !== null}
              >
                {isActive ? "Zapisywanie…" : label}
              </button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function getClientErrorMessage(error: unknown) {
  return error instanceof OperatorClientError
    ? error.message
    : "Nie udało się wykonać operacji. Spróbuj ponownie.";
}
