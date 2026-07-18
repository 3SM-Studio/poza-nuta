"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  SessionStateAlert,
  type SessionStateAlertKind,
} from "@/components/public/session-state-alert";
import { RequestStatusBadge } from "@/components/request-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { QueueRealtimeConnectionStatus } from "@/lib/queue-realtime";
import { getSessionCapabilityState } from "@/lib/session-capabilities";
import {
  normalizeSessionRequesterName,
  SESSION_REQUESTER_NAME_MAX_LENGTH,
  SESSION_REQUESTER_NAME_MIN_LENGTH,
} from "@/lib/session-request";
import type { PublicQueueResponse, PublicSong } from "./api";
import styles from "./public.module.css";
import {
  createSessionRequest,
  getSessionQueue,
  searchSessionSongs,
  SessionClientError,
  type SessionEvent,
} from "./session-api";
import {
  canSearchPublicSongs,
  formatSongSource,
  normalizePublicSearchTerm,
} from "./validation";
import { usePublicQueueRealtime } from "./use-public-queue-realtime";

type SessionRequestFormErrors = Partial<
  Record<"songId" | "requesterName", string>
>;

type SubmittedRequestSummary = {
  title: string;
  artist: string;
  requesterName: string;
};

export function SessionRequestPage({
  code,
  event,
}: {
  code: string;
  event: SessionEvent;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<PublicSong[]>([]);
  const [selectedSong, setSelectedSong] = useState<PublicSong | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [requesterName, setRequesterName] = useState("");
  const [formErrors, setFormErrors] = useState<SessionRequestFormErrors>({});
  const [submitAlert, setSubmitAlert] =
    useState<SessionStateAlertKind | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedRequest, setSubmittedRequest] =
    useState<SubmittedRequestSummary | null>(null);
  const [queue, setQueue] = useState<PublicQueueResponse | null>(null);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [isRefreshingQueue, setIsRefreshingQueue] = useState(false);
  const capabilities = getSessionCapabilityState(event);
  const canSubmitSongRequests = capabilities.canSubmitSongRequests;
  const canViewPublicQueue = capabilities.canViewPublicQueue;

  const loadQueue = useCallback(
    async (signal?: AbortSignal) => {
      if (!canViewPublicQueue) {
        return;
      }

      try {
        const response = await getSessionQueue(code, signal);

        setQueue(response);
        setQueueMessage(null);
      } catch (caughtError) {
        if (signal?.aborted || isAbortError(caughtError)) {
          return;
        }

        setQueueMessage(getQueueErrorMessage(caughtError));
      }
    },
    [canViewPublicQueue, code],
  );
  const liveStatus = usePublicQueueRealtime(
    canViewPublicQueue ? event.id : null,
    async (_reason, signal) => loadQueue(signal),
  );

  useEffect(() => {
    if (!canViewPublicQueue) {
      return;
    }

    const controller = new AbortController();

    async function initializeQueue() {
      await loadQueue(controller.signal);
    }

    void initializeQueue();

    return () => {
      controller.abort();
    };
  }, [canViewPublicQueue, loadQueue]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = normalizePublicSearchTerm(searchTerm);

    if (!canSearchPublicSongs(query)) {
      setSearchResults([]);
      setSearchMessage("Wpisz co najmniej 2 znaki.");
      return;
    }

    setIsSearching(true);
    setSearchMessage(null);
    setSubmitAlert(null);

    try {
      const songs = await searchSessionSongs(code, query);
      setSearchResults(songs);
      setSearchMessage(
        songs.length === 0 ? "Nie znaleziono pasujących piosenek." : null,
      );
    } catch {
      setSearchResults([]);
      setSearchMessage(
        "Nie udało się wyszukać piosenek. Spróbuj ponownie.",
      );
    } finally {
      setIsSearching(false);
    }
  }

  function selectSong(song: PublicSong) {
    setSelectedSong(song);
    setFormErrors((current) => ({ ...current, songId: undefined }));
    setSubmitAlert(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAlert(null);

    const validation = validateSessionRequestForm({
      songId: selectedSong?.id ?? null,
      requesterName,
    });

    if (!validation.success) {
      setFormErrors(validation.errors);
      return;
    }

    if (!selectedSong) {
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);

    try {
      await createSessionRequest(code, validation.data);
      setSubmittedRequest({
        title: selectedSong.title,
        artist: selectedSong.artist,
        requesterName: validation.data.requesterName,
      });
      setSelectedSong(null);
      setSearchTerm("");
      setSearchResults([]);
      setRequesterName("");
      toast.success("Dodano zgłoszenie", {
        description: "Operator musi je zatwierdzić.",
      });
      if (canViewPublicQueue) {
        await loadQueue();
      }
    } catch (caughtError) {
      const alertKind = getSubmitAlertKind(caughtError);
      if (alertKind) {
        setSubmitAlert(alertKind);
      } else {
        toast.error("Nie udało się dodać zgłoszenia", {
          description: getSubmitErrorMessage(caughtError),
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function refreshQueue() {
    if (!canViewPublicQueue) {
      return;
    }

    setIsRefreshingQueue(true);
    await loadQueue();
    setIsRefreshingQueue(false);
  }

  return (
    <>
      {capabilities.allSessionFeaturesDisabled ? (
        <section className={styles.publicSection}>
          <h2>Sesja wydarzenia</h2>
          <SessionStateAlert kind="queue_disabled" />
        </section>
      ) : null}

      {canSubmitSongRequests ? (
        <>
      <section className={styles.publicSection}>
        <div className={styles.sectionHeading}>
          <h2>Wybierz piosenkę</h2>
          <span className={styles.inlineMessage}>Sesja: {event.name}</span>
        </div>

        <form className={styles.searchForm} onSubmit={handleSearch}>
          <label className={styles.visuallyHidden} htmlFor="session-song-search">
            Tytuł lub wykonawca
          </label>
          <Input
            id="session-song-search"
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Tytuł lub wykonawca"
            disabled={isSearching || isSubmitting}
          />
          <Button
            type="submit"
            disabled={
              isSearching || isSubmitting || !canSearchPublicSongs(searchTerm)
            }
          >
            {isSearching ? "Szukam..." : "Szukaj"}
          </Button>
        </form>

        {searchMessage ? (
          <p className={styles.inlineMessage} role="status">
            {searchMessage}
          </p>
        ) : null}

        {searchResults.length > 0 ? (
          <div className={styles.searchResults} aria-label="Wyniki wyszukiwania">
            {searchResults.map((song) => (
              <button
                key={song.id}
                className={`${styles.songResult} ${
                  selectedSong?.id === song.id ? styles.selectedResult : ""
                }`}
                type="button"
                onClick={() => selectSong(song)}
                aria-pressed={selectedSong?.id === song.id}
                disabled={isSubmitting}
              >
                <span className={styles.songResultTitle}>{song.title}</span>
                <span className={styles.songResultArtist}>{song.artist}</span>
                <span className={styles.songResultMeta}>
                  Źródło: {formatSongSource(song.source)} · Duet:{" "}
                  {song.isDuet ? "tak" : "nie"} · Explicit:{" "}
                  {song.isExplicit ? "tak" : "nie"} · Plus:{" "}
                  {song.isPlus ? "tak" : "nie"} · Hit:{" "}
                  {song.isHit ? "tak" : "nie"}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className={styles.publicSection}>
        <h2>Twoje zgłoszenie</h2>

        <div
          className={`${styles.selectedSong} ${
            formErrors.songId ? styles.invalidSelection : ""
          }`}
        >
          <span className={styles.fieldLabel}>Wybrana piosenka</span>
          {selectedSong ? (
            <>
              <strong>{selectedSong.title}</strong>
              <span>{selectedSong.artist}</span>
            </>
          ) : (
            <span>Najpierw wybierz wynik wyszukiwania.</span>
          )}
        </div>
        {formErrors.songId ? (
          <p className={styles.fieldError}>{formErrors.songId}</p>
        ) : null}

        <form className={styles.requestForm} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="session-requester-name">
              Imię lub ksywka
            </label>
            <Input
              id="session-requester-name"
              type="text"
              required
              minLength={SESSION_REQUESTER_NAME_MIN_LENGTH}
              value={requesterName}
              onChange={(event) => {
                setRequesterName(event.target.value);
                setFormErrors((current) => ({
                  ...current,
                  requesterName: undefined,
                }));
                setSubmitAlert(null);
              }}
              maxLength={SESSION_REQUESTER_NAME_MAX_LENGTH}
              placeholder="Imię lub ksywka"
              disabled={isSubmitting}
            />
            <span className={styles.inlineMessage}>
              Podaj imię lub ksywkę, żeby operator wiedział, kogo zaprosić.
            </span>
            <span className={styles.characterCount}>
              {requesterName.length}/{SESSION_REQUESTER_NAME_MAX_LENGTH}
            </span>
            {formErrors.requesterName ? (
              <p className={styles.fieldError}>{formErrors.requesterName}</p>
            ) : null}
          </div>

          <Button
            className={styles.submitButton}
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Dodaję..." : "Dodaj do kolejki"}
          </Button>
        </form>

        {submitAlert ? <SessionStateAlert kind={submitAlert} /> : null}
        {submittedRequest ? (
          <Card data-submitted-request>
            <CardHeader>
              <CardTitle>Twoje ostatnie zgłoszenie</CardTitle>
              <RequestStatusBadge status="pending" />
            </CardHeader>
            <CardContent>
              <p>
                <strong>{submittedRequest.title}</strong> -{" "}
                {submittedRequest.artist}
              </p>
              <p className={styles.inlineMessage}>
                Zgłaszający: {submittedRequest.requesterName}. Zgłoszenie czeka
                na decyzję operatora.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </section>
        </>
      ) : null}

      {canViewPublicQueue ? (
      <section className={styles.publicSection}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Kolejka tej sesji</h2>
            <span className={styles.inlineMessage} role="status">
              {formatLiveStatus(liveStatus)}
            </span>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => void refreshQueue()}
            disabled={isRefreshingQueue}
          >
            {isRefreshingQueue ? "Odświeżanie…" : "Odśwież"}
          </button>
        </div>
        {queueMessage ? (
          <p className={styles.inlineMessage} role="status">
            {queueMessage}
          </p>
        ) : null}
        {queue && queue.items.length > 0 ? (
          <div className={styles.publicQueueList}>
            {queue.items.map((item) => (
              <article
                key={item.id}
                className={`${styles.publicQueueItem} ${
                  item.status === "now" ? styles.nowItem : ""
                }`}
              >
                <div>
                  <RequestStatusBadge status={item.status} />
                  <h2>{item.singerName}</h2>
                  {queue.showSongTitles && item.title ? (
                    <p>
                      {item.title} - {item.artist}
                    </p>
                  ) : item.status === "now" ? (
                    <p>Aktualnie śpiewane</p>
                  ) : (
                    <p>Tytuły piosenek są ukryte publicznie.</p>
                  )}
                </div>
                <span className={styles.queuePosition}>
                  {item.status === "now" ? "Teraz" : `#${item.position}`}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.inlineMessage}>
            Kolejka nie ma jeszcze publicznie widocznych zgłoszeń.
          </p>
        )}
      </section>
      ) : null}
    </>
  );
}

function validateSessionRequestForm(input: {
  songId: number | null;
  requesterName: string;
}):
  | {
      success: true;
      data: {
        songId: number;
        requesterName: string;
      };
    }
  | { success: false; errors: SessionRequestFormErrors } {
  const errors: SessionRequestFormErrors = {};
  const requesterName = normalizeSessionRequesterName(input.requesterName);

  if (
    input.songId === null ||
    !Number.isSafeInteger(input.songId) ||
    input.songId <= 0
  ) {
    errors.songId = "Wybierz piosenkę.";
  }

  if (requesterName.length < SESSION_REQUESTER_NAME_MIN_LENGTH) {
    errors.requesterName =
      "Podaj imię lub ksywkę, żeby operator wiedział, kogo zaprosić.";
  } else if (requesterName.length > SESSION_REQUESTER_NAME_MAX_LENGTH) {
    errors.requesterName = `Imię lub ksywka może mieć maksymalnie ${SESSION_REQUESTER_NAME_MAX_LENGTH} znaków.`;
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      songId: input.songId as number,
      requesterName,
    },
  };
}

function getSubmitErrorMessage(error: unknown) {
  if (error instanceof SessionClientError) {
    if (error.status === 400) {
      return "Sprawdź dane zgłoszenia i spróbuj ponownie.";
    }

    if (error.status === 404 && error.code === "SONG_NOT_FOUND") {
      return "Wybrana piosenka nie jest już dostępna. Wyszukaj ją ponownie.";
    }

    if (error.code === "SESSION_EVENT_NOT_STARTED") {
      return "Wydarzenie jeszcze się nie rozpoczęło.";
    }

    if (error.code === "SESSION_EVENT_CLOSED") {
      return "Zgłoszenia są już zamknięte.";
    }

    if (error.code === "SESSION_PUBLIC_REQUESTS_DISABLED") {
      return "Publiczne zgłoszenia są wyłączone.";
    }
  }

  return "Nie udało się dodać zgłoszenia. Spróbuj ponownie.";
}

function getSubmitAlertKind(
  error: unknown,
): SessionStateAlertKind | null {
  if (!(error instanceof SessionClientError)) return null;

  if (error.status === 429 || error.code === "SESSION_RATE_LIMITED") {
    return "rate_limited";
  }

  if (error.code === "SESSION_REQUEST_DUPLICATE") {
    return "duplicate_request";
  }

  if (error.code === "SESSION_EVENT_NOT_STARTED") return "scheduled";
  if (error.code === "SESSION_EVENT_CLOSED") return "closed";
  if (error.code === "SESSION_PUBLIC_REQUESTS_DISABLED") {
    return "queue_disabled";
  }

  return null;
}

function getQueueErrorMessage(error: unknown) {
  if (error instanceof SessionClientError) {
    if (error.code === "SESSION_EVENT_CLOSED") {
      return "Zgłoszenia są już zamknięte.";
    }

    if (error.code === "SESSION_PUBLIC_REQUESTS_DISABLED") {
      return "Publiczne zgłoszenia są wyłączone.";
    }
  }

  return "Nie udało się wczytać kolejki dla tej sesji. Możesz nadal wysłać zgłoszenie.";
}

function formatLiveStatus(status: QueueRealtimeConnectionStatus) {
  switch (status) {
    case "live":
      return "Połączenie live";
    case "unavailable":
      return "Live niedostępne";
    default:
      return "Łączenie live…";
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
