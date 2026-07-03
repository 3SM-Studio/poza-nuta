"use client";

import Link from "next/link";
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
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
        <Button variant="outline" asChild>
          <Link href="/queue">Widok publiczny</Link>
        </Button>
      </header>

      {success ? (
        <Alert className={styles.successMessage} role="status">
          <AlertTitle>Gotowe</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert className={styles.pageError} variant="destructive">
          <AlertTitle>Nie udało się wykonać operacji</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {event ? (
        <>
          {shouldWarnEventClosingSoon(event.autoCloseAt, now) ? (
            <Alert className={styles.eventWarning}>
              <AlertTitle>
                Event zakończy się za mniej niż 30 minut.
              </AlertTitle>
            </Alert>
          ) : null}

          <Card className={styles.overviewCard}>
            <CardHeader>
              <div>
                <CardDescription>Aktywny event</CardDescription>
                <CardTitle>{event.name}</CardTitle>
                <CardDescription>
                  {event.venue || "Lokal nie został podany"}
                </CardDescription>
              </div>
              <CardAction>
                <Badge>{event.status}</Badge>
              </CardAction>
            </CardHeader>

            <CardContent>
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
                  <dd>
                    {event.publicQueueEnabled ? "Włączona" : "Wyłączona"}
                  </dd>
                </div>
                <div>
                  <dt>Publiczne tytuły piosenek</dt>
                  <dd>
                    {event.publicShowSongTitles ? "Widoczne" : "Ukryte"}
                  </dd>
                </div>
              </dl>
            </CardContent>

            <CardFooter className={styles.lifecycleActions}>
              <Button
                type="button"
                onClick={() => void handleExtend(1)}
                disabled={activeAction !== null || isCloseConfirmationOpen}
              >
                {activeAction === "extend-1"
                  ? "Przedłużanie…"
                  : "Przedłuż +1h"}
              </Button>
              <Button
                type="button"
                onClick={() => void handleExtend(2)}
                disabled={activeAction !== null || isCloseConfirmationOpen}
              >
                {activeAction === "extend-2"
                  ? "Przedłużanie…"
                  : "Przedłuż +2h"}
              </Button>
              <Button
                variant="destructive"
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
              </Button>
            </CardFooter>
          </Card>

          <CloseEventConfirmation
            id="dashboard-close-event-confirmation"
            open={isCloseConfirmationOpen}
            isConfirming={activeAction === "close"}
            onCancel={() => setIsCloseConfirmationOpen(false)}
            onConfirm={() => void handleConfirmClose()}
          />

          <Card className={styles.overviewCard}>
            <CardHeader>
              <div>
                <CardDescription>Kolejka</CardDescription>
                <CardTitle>Liczniki zgłoszeń</CardTitle>
              </div>
              <CardAction>
                <Button variant="outline" asChild>
                  <Link href="/dashboard/queue">Otwórz kolejkę</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className={styles.counterGrid}>
              {queueCounters.map(({ status, label }) => (
                <Card size="sm" key={status}>
                  <CardHeader>
                    <CardTitle>{queue?.[status].length ?? 0}</CardTitle>
                    <CardDescription>{label}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className={styles.overviewCard}>
          <CardHeader>
            <CardTitle>Brak aktywnego eventu</CardTitle>
            <CardDescription>
              Uruchom nowy event w ustawieniach dashboardu.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <Link href="/dashboard/settings">Przejdź do ustawień</Link>
            </Button>
          </CardFooter>
        </Card>
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
