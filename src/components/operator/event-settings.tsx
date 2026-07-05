"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatWarsawDateTime } from "@/lib/warsaw-time";

import {
  closeDashboardEvent,
  extendDashboardEvent,
  getDashboardEvent,
  OperatorClientError,
  startDashboardEvent,
  type DashboardEvent,
  updateDashboardEventSettings,
} from "./api";
import { CloseEventConfirmation } from "./close-event-confirmation";
import { EventAccessLinksPanel } from "./event-access-links-panel";
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
  const [isCloseConfirmationOpen, setIsCloseConfirmationOpen] =
    useState(false);
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
      setIsCloseConfirmationOpen(false);
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
      <header className={styles.pageHeader}>
        <h1>Ustawienia eventu</h1>
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
          <Card className={styles.settingsCard}>
            <CardHeader>
              <CardTitle>Aktywny event</CardTitle>
              <CardAction>
                <Badge>{event.status}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <dl className={styles.eventDetails}>
                <div>
                  <dt>Start (czas polski)</dt>
                  <dd>{formatDateTime(event.startsAt)}</dd>
                </div>
                <div>
                  <dt>Automatyczne zamknięcie (czas polski)</dt>
                  <dd>{formatDateTime(event.autoCloseAt)}</dd>
                </div>
                {event.closedAt ? (
                  <div>
                    <dt>Zamknięty</dt>
                    <dd>{formatDateTime(event.closedAt)}</dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <EventAccessLinksPanel key={event.id} />

          <Card className={styles.settingsCard}>
            <CardHeader>
              <CardTitle>Edycja ustawień</CardTitle>
            </CardHeader>
            <CardContent>
              <form className={styles.settingsForm} onSubmit={handleSave}>
                <EventNameAndVenueFields
                  name={name}
                  venue={venue}
                  disabled={activeAction !== null}
                  onNameChange={setName}
                  onVenueChange={setVenue}
                />

                <Label className={styles.checkboxField}>
                  <input
                    type="checkbox"
                    checked={publicQueueEnabled}
                    onChange={(changeEvent) =>
                      setPublicQueueEnabled(changeEvent.target.checked)
                    }
                    disabled={activeAction !== null}
                  />
                  Publiczny podgląd kolejki
                </Label>

                <Label className={styles.checkboxField}>
                  <input
                    type="checkbox"
                    checked={publicShowSongTitles}
                    onChange={(changeEvent) =>
                      setPublicShowSongTitles(changeEvent.target.checked)
                    }
                    disabled={activeAction !== null}
                  />
                  Pokazuj tytuły piosenek publicznie
                </Label>

                <Button type="submit" disabled={activeAction !== null}>
                  {activeAction === "save" ? "Zapisywanie…" : "Zapisz"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className={styles.settingsCard}>
            <CardHeader>
              <CardTitle>Lifecycle</CardTitle>
            </CardHeader>
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
                aria-controls="settings-close-event-confirmation"
              >
                Zamknij event
              </Button>
            </CardFooter>
          </Card>
          <CloseEventConfirmation
            id="settings-close-event-confirmation"
            open={isCloseConfirmationOpen}
            isConfirming={activeAction === "close"}
            onCancel={() => setIsCloseConfirmationOpen(false)}
            onConfirm={() => void handleClose()}
          />
        </>
      ) : (
        <Card className={styles.settingsCard}>
          <CardHeader>
            <CardTitle>Uruchom nowy event</CardTitle>
            <CardDescription>
              Brak aktywnego eventu. Nowy event zostanie uruchomiony na 8
              godzin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className={styles.settingsForm} onSubmit={handleStart}>
              <EventNameAndVenueFields
                name={name}
                venue={venue}
                disabled={activeAction !== null}
                onNameChange={setName}
                onVenueChange={setVenue}
              />
              <Button type="submit" disabled={activeAction !== null}>
                {activeAction === "start" ? "Uruchamianie…" : "Start eventu"}
              </Button>
            </form>
          </CardContent>
        </Card>
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
      <div className={styles.dashboardField}>
        <Label htmlFor="event-name">Nazwa</Label>
        <Input
          id="event-name"
          type="text"
          value={name}
          onChange={(changeEvent) => onNameChange(changeEvent.target.value)}
          maxLength={120}
          disabled={disabled}
          required
        />
      </div>
      <div className={styles.dashboardField}>
        <Label htmlFor="event-venue">Lokal</Label>
        <Input
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

  return formatWarsawDateTime(value);
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
