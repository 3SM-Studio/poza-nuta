"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
import { cn } from "@/lib/utils";
import {
  isParticipantNicknameLengthValid,
  normalizeParticipantNickname,
} from "@/lib/participant-nickname";
import { getSessionCapabilityState } from "@/lib/session-capabilities";
import type {
  PublicQueueResponse,
  PublicSong,
  SessionSongDiscovery,
} from "./api";
import { ParticipantProfileDrawer } from "./participant-profile-drawer";
import { waitForMutationRealtimeOrFallback } from "./session-mutation-refresh";
import { SessionQueueList } from "./session-queue-list";
import { SessionShellHeader } from "./session-shell-header";
import { SessionSearchResults } from "./session-search-results";
import { SongDetailsDrawer } from "./song-details-drawer";
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
  normalizePublicSearchTerm,
} from "./validation";
import { usePublicQueueRealtime } from "./use-public-queue-realtime";

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
  const [submitAlert, setSubmitAlert] =
    useState<SessionStateAlertKind | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSongDetailsOpen, setIsSongDetailsOpen] = useState(false);
  const [displayName, setDisplayName] = useState(participantDisplayName ?? "");
  const [renameValue, setRenameValue] = useState(participantDisplayName ?? "");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameMessage, setRenameMessage] = useState<string | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isQueueView, setIsQueueView] = useState(false);
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
  const realtimeInvalidationVersionRef = useRef(0);
  const realtimeInvalidationWaitersRef = useRef(new Set<() => void>());
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
  const noteRealtimeInvalidation = useCallback(() => {
    realtimeInvalidationVersionRef.current += 1;
    const waiters = [...realtimeInvalidationWaitersRef.current];
    realtimeInvalidationWaitersRef.current.clear();
    waiters.forEach((resolve) => resolve());
  }, []);
  const waitForRealtimeOrRefresh = useCallback(
    (versionBeforeMutation: number) =>
      waitForMutationRealtimeOrFallback({
        onFallback: async (signal) => {
          await Promise.all([
            loadParticipantRequests(signal),
            canViewPublicQueue ? loadQueue(signal) : Promise.resolve(),
          ]);
        },
        realtimeInvalidationVersionRef,
        realtimeInvalidationWaitersRef,
        versionBeforeMutation,
      }),
    [canViewPublicQueue, loadParticipantRequests, loadQueue],
  );
  usePublicQueueRealtime(
    canViewPublicQueue || participantDisplayName ? sessionToken : null,
    async (reason, signal) => {
      noteRealtimeInvalidation();

      if (reason === "queue") {
        await Promise.all([
          loadParticipantRequests(signal),
          canViewPublicQueue ? loadQueue(signal) : Promise.resolve(),
        ]);
        return;
      }

      if (reason === "capabilities") {
        router.refresh();
        return;
      }

      const refreshed = await getSessionEvent(sessionToken, signal);

      if (
        refreshed.accessStatus !== "active" ||
        hasSessionEventChanged(event, refreshed.event)
      ) {
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

  useEffect(
    () => () => {
      const waiters = [...realtimeInvalidationWaitersRef.current];
      realtimeInvalidationWaitersRef.current.clear();
      waiters.forEach((resolve) => resolve());
    },
    [],
  );

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
      setIsProfileOpen(false);
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
    const invalidationVersion = realtimeInvalidationVersionRef.current;
    try {
      await cancelParticipantRequest(sessionToken, requestId);
      await waitForRealtimeOrRefresh(invalidationVersion);
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
    setSubmitAlert(null);
    setIsSongDetailsOpen(true);
  }

  function clearSearchResults() {
    setSearchResults([]);
    setSearchMessage(null);
    setSelectedSong(null);
    setIsSongDetailsOpen(false);
    setSubmitAlert(null);
  }

  async function submitSelectedSong() {
    if (isSubmitting || !selectedSong) return;
    setSubmitAlert(null);
    setIsSubmitting(true);

    try {
      const invalidationVersion = realtimeInvalidationVersionRef.current;
      await createSessionRequest(sessionToken, { songId: selectedSong.id });
      setSelectedSong(null);
      setSearchTerm("");
      setSearchResults([]);
      setSearchMessage(null);
      setIsSongDetailsOpen(false);
      toast.success("Dodano zgłoszenie", {
        description: "Operator musi je zatwierdzić.",
      });
      await waitForRealtimeOrRefresh(invalidationVersion);
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
    <div className="flex min-h-dvh max-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <SessionShellHeader
        isQueueView={isQueueView}
        isSearching={isSearching}
        isSubmitting={isSubmitting}
        onOpenProfile={() => {
          setRenameValue(displayName);
          setRenameMessage(null);
          setIsProfileOpen(true);
        }}
        onSearch={handleSearch}
        onSearchTermChange={setSearchTerm}
        onToggleQueue={() => setIsQueueView((current) => !current)}
        searchTerm={searchTerm}
        showQueue={canViewPublicQueue}
      />
      {canViewPublicQueue ? (
        <div className={cn("flex-1 overflow-y-auto overscroll-contain px-4 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-8", !isQueueView && "hidden")}>
          <SessionQueueList
            message={queueMessage}
            onRefresh={() => void refreshQueue()}
            queue={queue}
            refreshing={isRefreshingQueue}
          />
        </div>
      ) : null}
      <div className={cn("mx-auto w-full max-w-3xl flex-1 overflow-y-auto overscroll-contain px-4 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-8", isQueueView && "hidden")}>
      {capabilities.allSessionFeaturesDisabled ? (
        <section className="mb-7">
          <h2 className="mb-2 text-xl font-bold tracking-[-0.035em]">Sesja wydarzenia</h2>
          <SessionStateAlert kind="queue_disabled" />
        </section>
      ) : null}

      {canSubmitSongRequests ? (
        <>
      <section aria-label="Wyszukiwanie piosenek" className="mb-7">

        {searchResults.length === 0 && searchMessage === null && !isSearching && discovery ? (
          <SongDiscoveryTeaser
            sessionToken={sessionToken}
            discovery={discovery}
          />
        ) : null}

        <SessionSearchResults
          isLoading={isSearching}
          message={searchMessage}
          onBack={clearSearchResults}
          onSongSelect={selectSong}
          query={normalizePublicSearchTerm(searchTerm)}
          songs={searchResults}
        />
      </section>
        </>
      ) : null}

      {participantDisplayName ? (
        <section className="mb-7" aria-labelledby="participant-requests-heading">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-bold tracking-[-0.035em]" id="participant-requests-heading">Moje zgłoszenia</h2>
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
            <p className="mt-3 text-sm text-destructive" role="alert">{participantRequestsMessage}</p>
          ) : participantRequests === null ? (
            <p className="mt-3 text-sm text-muted-foreground" role="status">Wczytywanie zgłoszeń…</p>
          ) : participantRequests.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nie masz jeszcze zgłoszeń w tej sesji.</p>
          ) : (
            <div className="mt-3">
              {participantRequests.map((request) => (
                <article
                  className="flex items-start justify-between gap-4 border-b border-border px-0.5 py-4"
                  key={request.id}
                  data-participant-request-id={request.id}
                >
                  <div className="min-w-0">
                    <RequestStatusBadge status={request.status} />
                    <h3 className="mt-2 text-base font-extrabold tracking-[-0.02em]">{request.title}</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">{request.artist}</p>
                    {request.queuePosition !== null ? (
                      <p className="mt-2 text-sm text-muted-foreground">
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

      </div>
      <SongDetailsDrawer
        alert={submitAlert}
        isOpen={isSongDetailsOpen}
        isSubmitting={isSubmitting}
        onOpenChange={(open) => {
          setIsSongDetailsOpen(open);
          if (!open) setSubmitAlert(null);
        }}
        onSubmit={() => void submitSelectedSong()}
        song={selectedSong}
      />
      {participantDisplayName ? (
        <ParticipantProfileDrawer
          error={renameMessage}
          isOpen={isProfileOpen}
          isSaving={isRenaming}
          onOpenChange={setIsProfileOpen}
          onSubmit={handleRename}
          onValueChange={(value) => {
            setRenameValue(value);
            setRenameMessage(null);
          }}
          value={renameValue}
        />
      ) : null}
    </div>
  );
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

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function hasSessionEventChanged(current: SessionEvent, next: SessionEvent) {
  return (
    current.name !== next.name ||
    current.venue !== next.venue ||
    current.startsAt !== next.startsAt ||
    current.status !== next.status ||
    current.publicQueueEnabled !== next.publicQueueEnabled ||
    current.songRequestsEnabled !== next.songRequestsEnabled ||
    current.publicShowSongTitles !== next.publicShowSongTitles ||
    current.autoCloseAt !== next.autoCloseAt ||
    current.endsAt !== next.endsAt ||
    current.closedAt !== next.closedAt
  );
}
