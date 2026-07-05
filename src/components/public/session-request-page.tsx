"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { QueueRealtimeConnectionStatus } from "@/lib/queue-realtime";
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

const REQUEST_SUCCESS_MESSAGE =
  "Dodano zgłoszenie. Operator musi je zatwierdzić.";

type SessionRequestFormErrors = Partial<
  Record<"songId" | "requesterName", string>
>;

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
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [queue, setQueue] = useState<PublicQueueResponse | null>(null);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [isRefreshingQueue, setIsRefreshingQueue] = useState(false);

  const loadQueue = useCallback(
    async (signal?: AbortSignal) => {
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
    [code],
  );
  const liveStatus = usePublicQueueRealtime(
    event.id,
    async (_reason, signal) => loadQueue(signal),
  );

  useEffect(() => {
    const controller = new AbortController();

    async function initializeQueue() {
      await loadQueue(controller.signal);
    }

    void initializeQueue();

    return () => {
      controller.abort();
    };
  }, [loadQueue]);

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
    setSubmitMessage(null);

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
    setSubmitMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitMessage(null);

    const validation = validateSessionRequestForm({
      songId: selectedSong?.id ?? null,
      requesterName,
    });

    if (!validation.success) {
      setFormErrors(validation.errors);
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);

    try {
      await createSessionRequest(code, validation.data);
      setSelectedSong(null);
      setSearchTerm("");
      setSearchResults([]);
      setRequesterName("");
      setSubmitMessage(REQUEST_SUCCESS_MESSAGE);
      await loadQueue();
    } catch (caughtError) {
      setSubmitMessage(getSubmitErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function refreshQueue() {
    setIsRefreshingQueue(true);
    await loadQueue();
    setIsRefreshingQueue(false);
  }

  return (
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
          <input
            id="session-song-search"
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Tytuł lub wykonawca"
            disabled={isSearching || isSubmitting}
          />
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={
              isSearching || isSubmitting || !canSearchPublicSongs(searchTerm)
            }
          >
            {isSearching ? "Szukam..." : "Szukaj"}
          </button>
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
            <input
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

          <button
            className={`${styles.primaryButton} ${styles.submitButton}`}
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Dodaję..." : "Dodaj do kolejki"}
          </button>
        </form>

        {submitMessage ? (
          <div
            className={
              submitMessage === REQUEST_SUCCESS_MESSAGE
                ? styles.successMessage
                : styles.errorMessage
            }
            role={
              submitMessage === REQUEST_SUCCESS_MESSAGE ? "status" : "alert"
            }
          >
            {submitMessage}
          </div>
        ) : null}
      </section>

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
                  <span className={styles.queueStatus}>
                    {item.status === "now"
                      ? "Aktualnie śpiewane"
                      : "Zaakceptowane"}
                  </span>
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
