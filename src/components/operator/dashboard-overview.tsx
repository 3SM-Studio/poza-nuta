"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  formatEventTimeRemaining,
  shouldWarnEventClosingSoon,
} from "../../lib/event-lifecycle";
import {
  closeDashboardEvent,
  extendDashboardEvent,
  getDashboardEvent,
  getOperatorQueue,
  OperatorClientError,
  type DashboardEvent,
  type OperatorQueueResponse,
  type OperatorRequestStatus,
} from "./api";
import { CloseEventConfirmation } from "./close-event-confirmation";
import styles from "./operator.module.css";

const queueCounters: Array<{
  status: OperatorRequestStatus;
  label: string;
}> = [
  { status: "pending", label: "Oczekujące" },
  { status: "approved", label: "Zatwierdzone" },
  { status: "now", label: "Teraz" },
  { status: "done", label: "Zakończone" },
  { status: "skipped", label: "Pominięte" },
  { status: "rejected", label: "Odrzucone" },
];

export function DashboardOverview() {
  const router = useRouter();
  const [event, setEvent] = useState<DashboardEvent | null>(null);
  const [queue, setQueue] = useState<OperatorQueueResponse["queue"] | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [isCloseConfirmationOpen, setIsCloseConfirmationOpen] =
    useState(false);
  const [now, setNow] = useState(() => new Date());
  const [success, setSuccess] = useState<string | null>(null);
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

  const loadOverview = useCallback(async () => {
    const eventResponse = await getDashboardEvent();
    setEvent(eventResponse.event);

    if (!eventResponse.event) {
      setQueue(null);
      return;
    }

    const queueResponse = await getOperatorQueue();
    setQueue(queueResponse.queue);
  }, []);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        await loadOverview();
      } catch (caughtError) {
        if (active && !handleAuthenticationError(caughtError)) {
          setError(getClientErrorMessage(caughtError));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [handleAuthenticationError, loadOverview]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  async function runEventAction(
    action: string,
    operation: () => Promise<void>,
  ) {
    setActiveAction(action);
    setSuccess(null);
    setError(null);

    try {
      await operation();
      await loadOverview();
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        setError(getClientErrorMessage(caughtError));
      }
    } finally {
      setActiveAction(null);
    }
  }

  async function handleExtend(hours: 1 | 2) {
    await runEventAction(`extend-${hours}`, async () => {
      await extendDashboardEvent(hours);
      setSuccess(`Event został przedłużony o ${hours}h.`);
    });
  }

  async function handleConfirmClose() {
    await runEventAction("close", async () => {
      await closeDashboardEvent();
      setIsCloseConfirmationOpen(false);
      setSuccess("Event został zamknięty.");
    });
  }

  if (isLoading) {
    return (
      <div className={styles.loadingScreen} role="status">
        Ładowanie dashboardu…
      </div>
    );
  }

  return (
    <div className={styles.overviewShell}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Dashboard</h1>
          <p className={styles.eventMeta}>
            Przegląd aktywnego eventu i kolejki.
          </p>
        </div>
        <Link href="/queue">Widok publiczny</Link>
      </header>

      {success ? (
        <div className={styles.successMessage} role="status">
          {success}
        </div>
      ) : null}

      {error ? (
        <div className={styles.pageError} role="alert">
          {error}
        </div>
      ) : null}

      {event ? (
        <>
          {shouldWarnEventClosingSoon(event.autoCloseAt, now) ? (
            <div className={styles.eventWarning} role="alert">
              <strong>Event zakończy się za mniej niż 30 minut.</strong>
            </div>
          ) : null}

          <section className={styles.overviewCard}>
            <div className={styles.overviewCardHeader}>
              <div>
                <p className={styles.overviewEyebrow}>Aktywny event</p>
                <h2>{event.name}</h2>
                <p>{event.venue || "Lokal nie został podany"}</p>
              </div>
              <span className={`${styles.status} ${styles.now}`}>
                {event.status}
              </span>
            </div>

            <dl className={styles.eventDetails}>
              <div>
                <dt>Start</dt>
                <dd>{formatDateTime(event.startsAt)}</dd>
              </div>
              <div>
                <dt>Automatyczne zamknięcie</dt>
                <dd>{formatDateTime(event.autoCloseAt)}</dd>
              </div>
              <div>
                <dt>Czas do zamknięcia</dt>
                <dd>{formatEventTimeRemaining(event.autoCloseAt, now)}</dd>
              </div>
              <div>
                <dt>Publiczna kolejka</dt>
                <dd>{event.publicQueueEnabled ? "Włączona" : "Wyłączona"}</dd>
              </div>
              <div>
                <dt>Publiczne tytuły piosenek</dt>
                <dd>
                  {event.publicShowSongTitles ? "Widoczne" : "Ukryte"}
                </dd>
              </div>
            </dl>

            <div className={styles.lifecycleActions}>
              <button
                className={`${styles.button} ${styles.actionButton}`}
                type="button"
                onClick={() => void handleExtend(1)}
                disabled={
                  activeAction !== null || isCloseConfirmationOpen
                }
              >
                {activeAction === "extend-1"
                  ? "Przedłużanie…"
                  : "Przedłuż +1h"}
              </button>
              <button
                className={`${styles.button} ${styles.actionButton}`}
                type="button"
                onClick={() => void handleExtend(2)}
                disabled={
                  activeAction !== null || isCloseConfirmationOpen
                }
              >
                {activeAction === "extend-2"
                  ? "Przedłużanie…"
                  : "Przedłuż +2h"}
              </button>
              <button
                className={`${styles.button} ${styles.dangerButton}`}
                type="button"
                onClick={() => {
                  setSuccess(null);
                  setError(null);
                  setIsCloseConfirmationOpen(true);
                }}
                disabled={activeAction !== null}
                aria-expanded={isCloseConfirmationOpen}
                aria-controls="dashboard-close-event-confirmation"
              >
                Zamknij event
              </button>
            </div>

            <CloseEventConfirmation
              id="dashboard-close-event-confirmation"
              open={isCloseConfirmationOpen}
              isConfirming={activeAction === "close"}
              onCancel={() => setIsCloseConfirmationOpen(false)}
              onConfirm={() => void handleConfirmClose()}
            />
          </section>

          <section className={styles.overviewCard}>
            <div className={styles.overviewCardHeader}>
              <div>
                <p className={styles.overviewEyebrow}>Kolejka</p>
                <h2>Liczniki zgłoszeń</h2>
              </div>
              <Link href="/dashboard/queue">Otwórz kolejkę</Link>
            </div>
            <div className={styles.counterGrid}>
              {queueCounters.map(({ status, label }) => (
                <div className={styles.counterCard} key={status}>
                  <strong>{queue?.[status].length ?? 0}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className={styles.overviewCard}>
          <h2>Brak aktywnego eventu</h2>
          <p className={styles.settingsIntro}>
            Uruchom nowy event w ustawieniach dashboardu.
          </p>
          <Link
            className={`${styles.button} ${styles.primaryButton}`}
            href="/dashboard/settings"
          >
            Przejdź do ustawień
          </Link>
        </section>
      )}
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getClientErrorMessage(error: unknown) {
  if (error instanceof OperatorClientError && error.status === 404) {
    return "Aktywny event nie jest już dostępny. Odśwież stronę.";
  }

  return "Nie udało się wczytać dashboardu. Spróbuj ponownie.";
}
