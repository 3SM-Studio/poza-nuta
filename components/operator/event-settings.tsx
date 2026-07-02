"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  closeDashboardEvent,
  extendDashboardEvent,
  getDashboardEvent,
  OperatorClientError,
  startDashboardEvent,
  type DashboardEvent,
  updateDashboardEventSettings,
} from "./api";
import styles from "./operator.module.css";

export function DashboardEventSettings() {
  const router = useRouter();
  const [event, setEvent] = useState<DashboardEvent | null>(null);
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [publicQueueEnabled, setPublicQueueEnabled] = useState(false);
  const [publicShowSongTitles, setPublicShowSongTitles] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [activeAction, setActiveAction] = useState<string | null>(null);
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

  const applyEventToForm = useCallback((nextEvent: DashboardEvent | null) => {
    setEvent(nextEvent);
    setName(nextEvent?.name ?? "");
    setVenue(nextEvent?.venue ?? "");
    setPublicQueueEnabled(nextEvent?.publicQueueEnabled ?? false);
    setPublicShowSongTitles(nextEvent?.publicShowSongTitles ?? true);
  }, []);

  const loadEvent = useCallback(async () => {
    const response = await getDashboardEvent();
    applyEventToForm(response.event);
  }, [applyEventToForm]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const response = await getDashboardEvent();

        if (active) {
          applyEventToForm(response.event);
        }
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
  }, [applyEventToForm, handleAuthenticationError]);

  async function handleSave(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    await runAction("save", async () => {
      const response = await updateDashboardEventSettings({
        name,
        venue: venue.trim() || null,
        publicQueueEnabled,
        publicShowSongTitles,
      });
      applyEventToForm(response.event);
      setSuccess("Ustawienia eventu zostały zapisane.");
    });
  }

  async function handleStart(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    await runAction("start", async () => {
      const response = await startDashboardEvent({
        name,
        venue: venue.trim() || null,
      });
      applyEventToForm(response.event);
      setSuccess("Event został uruchomiony na 8 godzin.");
    });
  }

  async function handleExtend(hours: 1 | 2) {
    await runAction(`extend-${hours}`, async () => {
      const response = await extendDashboardEvent(hours);
      applyEventToForm(response.event);
      setSuccess(`Event został przedłużony o ${hours}h.`);
    });
  }

  async function handleClose() {
    await runAction("close", async () => {
      await closeDashboardEvent();
      await loadEvent();
      setSuccess("Event został zamknięty.");
    });
  }

  async function runAction(action: string, operation: () => Promise<void>) {
    setActiveAction(action);
    setSuccess(null);
    setError(null);

    try {
      await operation();
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        if (
          caughtError instanceof OperatorClientError &&
          caughtError.status === 404
        ) {
          await loadEvent();
        }
        setError(getClientErrorMessage(caughtError));
      }
    } finally {
      setActiveAction(null);
    }
  }

  if (isLoading) {
    return (
      <div className={styles.loadingScreen} role="status">
        Ładowanie ustawień…
      </div>
    );
  }

  return (
    <div className={styles.settingsShell}>
      <header className={styles.settingsHeader}>
        <div>
          <p className={styles.brand}>Poza Nutą</p>
          <h1>Ustawienia eventu</h1>
        </div>
        <Link
          className={`${styles.button} ${styles.secondaryButton}`}
          href="/dashboard/queue"
        >
          Powrót do kolejki
        </Link>
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
          <section className={styles.settingsCard}>
            <h2>Aktywny event</h2>
            <dl className={styles.eventDetails}>
              <div>
                <dt>Status</dt>
                <dd>{event.status}</dd>
              </div>
              <div>
                <dt>Start</dt>
                <dd>{formatDateTime(event.startsAt)}</dd>
              </div>
              <div>
                <dt>Automatyczne zamknięcie</dt>
                <dd>{formatDateTime(event.autoCloseAt)}</dd>
              </div>
              {event.closedAt ? (
                <div>
                  <dt>Zamknięty</dt>
                  <dd>{formatDateTime(event.closedAt)}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className={styles.settingsCard}>
            <h2>Edycja ustawień</h2>
            <form className={styles.settingsForm} onSubmit={handleSave}>
              <EventNameAndVenueFields
                name={name}
                venue={venue}
                disabled={activeAction !== null}
                onNameChange={setName}
                onVenueChange={setVenue}
              />

              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={publicQueueEnabled}
                  onChange={(changeEvent) =>
                    setPublicQueueEnabled(changeEvent.target.checked)
                  }
                  disabled={activeAction !== null}
                />
                Publiczny podgląd kolejki
              </label>

              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={publicShowSongTitles}
                  onChange={(changeEvent) =>
                    setPublicShowSongTitles(changeEvent.target.checked)
                  }
                  disabled={activeAction !== null}
                />
                Pokazuj tytuły piosenek publicznie
              </label>

              <button
                className={`${styles.button} ${styles.primaryButton}`}
                type="submit"
                disabled={activeAction !== null}
              >
                {activeAction === "save" ? "Zapisywanie…" : "Zapisz"}
              </button>
            </form>
          </section>

          <section className={styles.settingsCard}>
            <h2>Lifecycle</h2>
            <div className={styles.lifecycleActions}>
              <button
                className={`${styles.button} ${styles.actionButton}`}
                type="button"
                onClick={() => void handleExtend(1)}
                disabled={activeAction !== null}
              >
                {activeAction === "extend-1"
                  ? "Przedłużanie…"
                  : "Przedłuż +1h"}
              </button>
              <button
                className={`${styles.button} ${styles.actionButton}`}
                type="button"
                onClick={() => void handleExtend(2)}
                disabled={activeAction !== null}
              >
                {activeAction === "extend-2"
                  ? "Przedłużanie…"
                  : "Przedłuż +2h"}
              </button>
              <button
                className={`${styles.button} ${styles.dangerButton}`}
                type="button"
                onClick={() => void handleClose()}
                disabled={activeAction !== null}
              >
                {activeAction === "close" ? "Zamykanie…" : "Zamknij event"}
              </button>
            </div>
          </section>
        </>
      ) : (
        <section className={styles.settingsCard}>
          <h2>Uruchom nowy event</h2>
          <p className={styles.settingsIntro}>
            Brak aktywnego eventu. Nowy event zostanie uruchomiony na 8 godzin.
          </p>
          <form className={styles.settingsForm} onSubmit={handleStart}>
            <EventNameAndVenueFields
              name={name}
              venue={venue}
              disabled={activeAction !== null}
              onNameChange={setName}
              onVenueChange={setVenue}
            />
            <button
              className={`${styles.button} ${styles.primaryButton}`}
              type="submit"
              disabled={activeAction !== null}
            >
              {activeAction === "start" ? "Uruchamianie…" : "Start eventu"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

type EventNameAndVenueFieldsProps = {
  name: string;
  venue: string;
  disabled: boolean;
  onNameChange: (value: string) => void;
  onVenueChange: (value: string) => void;
};

function EventNameAndVenueFields({
  name,
  venue,
  disabled,
  onNameChange,
  onVenueChange,
}: EventNameAndVenueFieldsProps) {
  return (
    <>
      <div className={styles.field}>
        <label htmlFor="event-name">Nazwa</label>
        <input
          id="event-name"
          type="text"
          value={name}
          onChange={(changeEvent) => onNameChange(changeEvent.target.value)}
          maxLength={120}
          disabled={disabled}
          required
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="event-venue">Lokal</label>
        <input
          id="event-venue"
          type="text"
          value={venue}
          onChange={(changeEvent) => onVenueChange(changeEvent.target.value)}
          maxLength={120}
          disabled={disabled}
        />
      </div>
    </>
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
  if (error instanceof OperatorClientError) {
    if (error.status === 404) {
      return "Brak aktywnego eventu. Odśwież stronę.";
    }

    if (error.status === 409) {
      return "Aktywny event już istnieje.";
    }

    if (error.status === 400) {
      return "Sprawdź dane formularza.";
    }
  }

  return "Nie udało się wykonać operacji. Spróbuj ponownie.";
}
