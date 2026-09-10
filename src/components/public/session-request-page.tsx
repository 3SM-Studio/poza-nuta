"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  SessionStateAlert,
  type SessionStateAlertKind,
} from "@/components/public/session-state-alert";
import { RequestStatusBadge } from "@/components/request-status-badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getParticipantNicknameLength,
  isParticipantNicknameLengthValid,
  normalizeParticipantNickname,
  PARTICIPANT_NICKNAME_MAX_LENGTH,
} from "@/lib/participant-nickname";
import type { QueueRealtimeConnectionStatus } from "@/lib/queue-realtime";
import { getSessionCapabilityState } from "@/lib/session-capabilities";
import type {
  PublicQueueResponse,
  PublicSong,
  SessionSongDiscovery,
} from "./api";
import styles from "./public.module.css";
import { SongDiscoveryTeaser } from "./song-discovery-page";
import {
  cancelParticipantRequest,
  createSessionRequest,
  getParticipantRequests,
  getSessionEvent,
  getSessionQueue,
  renameSessionParticipant,
  searchSessionSongs,
  SessionClientError,
  type ParticipantRequest,
  type SessionEvent,
} from "./session-api";
import {
  canSearchPublicSongs,
  formatSongSource,
  normalizePublicSearchTerm,
} from "./validation";
import { usePublicQueueRealtime } from "./use-public-queue-realtime";

type SessionRequestFormErrors = Partial<Record<"songId", string>>;

export function SessionRequestPage({
  sessionToken,
  event,
  participantDisplayName,
  discovery,
}: {
  sessionToken: string;
  event: SessionEvent;
  participantDisplayName?: string;
  discovery?: SessionSongDiscovery;
}) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<PublicSong[]>([]);
  const [selectedSong, setSelectedSong] = useState<PublicSong | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [formErrors, setFormErrors] = useState<SessionRequestFormErrors>({});
  const [submitAlert, setSubmitAlert] =
    useState<SessionStateAlertKind | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [displayName, setDisplayName] = useState(participantDisplayName ?? "");
  const [renameValue, setRenameValue] = useState(participantDisplayName ?? "");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameMessage, setRenameMessage] = useState<string | null>(null);
  const [participantRequests, setParticipantRequests] =
    useState<ParticipantRequest[] | null>(null);
  const [participantRequestsMessage, setParticipantRequestsMessage] =
    useState<string | null>(null);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);
  const [cancelDialogRequestId, setCancelDialogRequestId] = useState<string | null>(
    null,
  );
  const [queue, setQueue] = useState<PublicQueueResponse | null>(null);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [isRefreshingQueue, setIsRefreshingQueue] = useState(false);
  const capabilities = getSessionCapabilityState(event);
  const canSubmitSongRequests = capabilities.canSubmitSongRequests;
  const canViewPublicQueue = capabilities.canViewPublicQueue;

  const loadParticipantRequests = useCallback(
    async (signal?: AbortSignal) => {
      if (!participantDisplayName) return;
      try {
        const response = await getParticipantRequests(sessionToken, signal);
        setParticipantRequests(response.items);
        setParticipantRequestsMessage(null);
      } catch (caughtError) {
        if (signal?.aborted || isAbortError(caughtError)) return;
        if (
          caughtError instanceof SessionClientError &&
          caughtError.code === "SESSION_PARTICIPANT_REQUIRED"
        ) {
          router.refresh();
          return;
        }
        setParticipantRequestsMessage(
          "Nie udało się wczytać Twoich zgłoszeń. Spróbuj ponownie.",
        );
      }
    },
    [participantDisplayName, router, sessionToken],
  );

  const loadQueue = useCallback(
    async (signal?: AbortSignal) => {
      if (!canViewPublicQueue) {
        return;
      }

      try {
        const response = await getSessionQueue(sessionToken, signal);

        setQueue(response);
        setQueueMessage(null);
      } catch (caughtError) {
        if (signal?.aborted || isAbortError(caughtError)) {
          return;
        }

        setQueueMessage(getQueueErrorMessage(caughtError));
      }
    },
    [canViewPublicQueue, sessionToken],
  );
  const liveStatus = usePublicQueueRealtime(
    canViewPublicQueue || participantDisplayName ? sessionToken : null,
    async (_reason, signal) => {
      const refreshed = await getSessionEvent(sessionToken);
      const capabilitiesChanged =
        refreshed.event.publicQueueEnabled !== event.publicQueueEnabled ||
        refreshed.event.songRequestsEnabled !== event.songRequestsEnabled ||
        refreshed.event.publicShowSongTitles !== event.publicShowSongTitles;

      if (refreshed.accessStatus !== "active" || capabilitiesChanged) {
        router.refresh();
        return;
      }

      await Promise.all([
        loadParticipantRequests(signal),
        canViewPublicQueue ? loadQueue(signal) : Promise.resolve(),
      ]);
    },
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

  useEffect(() => {
    if (!participantDisplayName) return;
    const controller = new AbortController();
    async function initializeParticipantRequests() {
      await loadParticipantRequests(controller.signal);
    }
    void initializeParticipantRequests();
    return () => controller.abort();
  }, [loadParticipantRequests, participantDisplayName]);

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nickname = normalizeParticipantNickname(renameValue);

    if (!isParticipantNicknameLengthValid(nickname.displayName)) {
      setRenameMessage("Nazwa musi mieć od 2 do 24 znaków.");
      return;
    }

    setIsRenaming(true);
    setRenameMessage(null);
    try {
      const response = await renameSessionParticipant(
        sessionToken,
        nickname.displayName,
      );
      setDisplayName(response.participant.displayName);
      setRenameValue(response.participant.displayName);
      toast.success("Nazwa została zmieniona");
    } catch (caughtError) {
      if (
        caughtError instanceof SessionClientError &&
        caughtError.code === "SESSION_PARTICIPANT_REQUIRED"
      ) {
        router.refresh();
        return;
      }
      setRenameMessage(getRenameErrorMessage(caughtError));
    } finally {
      setIsRenaming(false);
    }
  }

  async function handleCancel(requestId: string) {
    if (cancellingRequestId !== null) return;
    setCancellingRequestId(requestId);
    let succeeded = false;
    try {
      await cancelParticipantRequest(sessionToken, requestId);
      await loadParticipantRequests();
      succeeded = true;
      toast.success("Zgłoszenie zostało anulowane");
    } catch (caughtError) {
      if (
        caughtError instanceof SessionClientError &&
        caughtError.code === "SESSION_PARTICIPANT_REQUIRED"
      ) {
        router.refresh();
        return;
      }
      toast.error("Nie udało się anulować zgłoszenia", {
        description: getCancelErrorMessage(caughtError),
      });
      await loadParticipantRequests();
    } finally {
      setCancellingRequestId(null);
      if (succeeded) setCancelDialogRequestId(null);
    }
  }

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
      const songs = await searchSessionSongs(sessionToken, query);
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
      await createSessionRequest(sessionToken, validation.data);
      setSelectedSong(null);
      setSearchTerm("");
      setSearchResults([]);
      toast.success("Dodano zgłoszenie", {
        description: "Operator musi je zatwierdzić.",
      });
      await Promise.all([
        loadParticipantRequests(),
        canViewPublicQueue ? loadQueue() : Promise.resolve(),
      ]);
    } catch (caughtError) {
      if (
        caughtError instanceof SessionClientError &&
        caughtError.code === "SESSION_PARTICIPANT_REQUIRED"
      ) {
        router.refresh();
        return;
      }
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
      {participantDisplayName ? (
        <section className={styles.publicSection} aria-labelledby="participant-identity-heading">
          <h2 id="participant-identity-heading">Twoja nazwa</h2>
          <p className={styles.inlineMessage}>
            Dołączono jako <strong>{displayName}</strong>
          </p>
          <form className={styles.renameForm} onSubmit={handleRename}>
            <label className={styles.fieldLabel} htmlFor="participant-display-name">
              Zmień nazwę w tym wydarzeniu
            </label>
            <div className={styles.inlineForm}>
              <Input
                id="participant-display-name"
                value={renameValue}
                onChange={(event) => {
                  setRenameValue(event.target.value);
                  setRenameMessage(null);
                }}
                autoComplete="nickname"
                aria-invalid={Boolean(renameMessage)}
                aria-describedby={
                  renameMessage ? "participant-rename-error" : undefined
                }
                disabled={isRenaming}
              />
              <Button type="submit" variant="outline" disabled={isRenaming}>
                {isRenaming ? "Zapisuję…" : "Zapisz"}
              </Button>
            </div>
            <span className={styles.characterCount}>
              {getParticipantNicknameLength(
                normalizeParticipantNickname(renameValue).displayName,
              )}
              /{PARTICIPANT_NICKNAME_MAX_LENGTH}
            </span>
            {renameMessage ? (
              <p
                className={styles.fieldError}
                id="participant-rename-error"
                role="alert"
              >
                {renameMessage}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}

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

        {discovery ? (
          <SongDiscoveryTeaser
            sessionToken={sessionToken}
            discovery={discovery}
          />
        ) : null}

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
          <Button
            className={styles.submitButton}
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Dodaję..." : "Dodaj do kolejki"}
          </Button>
        </form>

        {submitAlert ? <SessionStateAlert kind={submitAlert} /> : null}
      </section>
        </>
      ) : null}

      {participantDisplayName ? (
        <section className={styles.publicSection} aria-labelledby="participant-requests-heading">
          <div className={styles.sectionHeading}>
            <h2 id="participant-requests-heading">Moje zgłoszenia</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void loadParticipantRequests()}
            >
              Odśwież
            </Button>
          </div>
          {participantRequestsMessage ? (
            <p className={styles.errorMessage} role="alert">{participantRequestsMessage}</p>
          ) : participantRequests === null ? (
            <p className={styles.inlineMessage} role="status">Wczytywanie zgłoszeń…</p>
          ) : participantRequests.length === 0 ? (
            <p className={styles.inlineMessage}>Nie masz jeszcze zgłoszeń w tej sesji.</p>
          ) : (
            <div className={styles.participantRequestList}>
              {participantRequests.map((request) => (
                <article
                  className={styles.participantRequestItem}
                  key={request.id}
                  data-participant-request-id={request.id}
                >
                  <div>
                    <RequestStatusBadge status={request.status} />
                    <h3>{request.title}</h3>
                    <p>{request.artist}</p>
                    {request.queuePosition !== null ? (
                      <p className={styles.inlineMessage}>
                        Pozycja zgłoszenia w kolejce: #{request.queuePosition}
                        {request.isNext ? " · Następne zaakceptowane zgłoszenie" : ""}
                      </p>
                    ) : null}
                  </div>
                  {request.status === "pending" ? (
                    <AlertDialog
                      open={cancelDialogRequestId === request.id}
                      onOpenChange={(open) => {
                        if (cancellingRequestId !== null) return;
                        setCancelDialogRequestId(open ? request.id : null);
                      }}
                    >
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={cancellingRequestId !== null}
                        >
                          {cancellingRequestId === request.id
                            ? "Anuluję…"
                            : "Anuluj"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Anulować zgłoszenie?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {request.title} — {request.artist}. Tej operacji nie można cofnąć po stronie uczestnika.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={cancellingRequestId !== null}>
                            Wróć
                          </AlertDialogCancel>
                          <Button
                            type="button"
                            variant="destructive"
                            disabled={cancellingRequestId !== null}
                            onClick={() => void handleCancel(request.id)}
                          >
                            {cancellingRequestId === request.id ? "Anuluję…" : "Anuluj zgłoszenie"}
                          </Button>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
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
}):
  | {
      success: true;
      data: {
        songId: number;
      };
    }
  | { success: false; errors: SessionRequestFormErrors } {
  const errors: SessionRequestFormErrors = {};

  if (
    input.songId === null ||
    !Number.isSafeInteger(input.songId) ||
    input.songId <= 0
  ) {
    errors.songId = "Wybierz piosenkę.";
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      songId: input.songId as number,
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

function getRenameErrorMessage(error: unknown) {
  if (error instanceof SessionClientError) {
    if (error.code === "SESSION_NICKNAME_TAKEN") {
      return "Ta nazwa jest już używana w tym wydarzeniu.";
    }
    if (error.status === 400) {
      return "Nazwa musi mieć od 2 do 24 znaków.";
    }
    if (error.code === "SESSION_EVENT_CLOSED") {
      return "Nie można zmienić nazwy po zamknięciu wydarzenia.";
    }
  }
  return "Nie udało się zmienić nazwy. Spróbuj ponownie.";
}

function getCancelErrorMessage(error: unknown) {
  if (error instanceof SessionClientError) {
    if (error.code === "SESSION_REQUEST_CANNOT_CANCEL") {
      return "Status zgłoszenia właśnie się zmienił. Można anulować tylko oczekujące zgłoszenie.";
    }
    if (error.code === "SESSION_EVENT_CLOSED") {
      return "Wydarzenie jest już zamknięte.";
    }
    if (error.code === "SESSION_REQUEST_NOT_FOUND") {
      return "Nie znaleziono tego zgłoszenia w Twojej sesji.";
    }
  }
  return "Odśwież listę i spróbuj ponownie.";
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
