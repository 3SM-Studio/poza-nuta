"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import {
  SessionStateAlert,
  type SessionStateAlertKind,
} from "@/components/public/session-state-alert";
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
import {
  CatalogCollectionSongList,
  CatalogCollectionUnavailable,
  CatalogSongList,
} from "./catalog-song-list";
import { ParticipantProfileDrawer } from "./participant-profile-drawer";
import { waitForMutationRealtimeOrFallback } from "./session-mutation-refresh";
import { SessionQueuePanel } from "./session-queue-panel";
import { SessionShellHeader } from "./session-shell-header";
import { SessionSearchResults } from "./session-search-results";
import { SessionCatalogGenres } from "./session-catalog-genres";
import { SessionCatalogCollections } from "./session-catalog-collections";
import { getSessionCatalogRoute, type SessionCatalogRoute } from "./session-catalog-route";
import { SongDetailsDrawer } from "./song-details-drawer";
import { SessionDiscoveryHome } from "./session-discovery-home";
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<PublicSong[]>([]);
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string | null>(null);
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
  const [isQueueOpen, setIsQueueOpen] = useState(false);
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
  const searchControllerRef = useRef<AbortController | null>(null);
  const searchVersionRef = useRef(0);
  const searchDebounceRef = useRef<number | null>(null);
  const shouldDebounceSearchRef = useRef(false);
  const lastDispatchedSearchQueryRef = useRef<string | null>(null);
  const enteredSearchFromSessionRef = useRef(false);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const searchScrollPositionRef = useRef<{ main: number; page: number } | null>(null);
  const lastPathnameRef = useRef(pathname);
  const hasClientNavigationRef = useRef(false);
  const capabilities = getSessionCapabilityState(event);
  const canSubmitSongRequests = capabilities.canSubmitSongRequests;
  const canViewPublicQueue = capabilities.canViewPublicQueue;
  const normalizedSearchTerm = normalizePublicSearchTerm(searchTerm);
  const isSearchRoute = pathname.endsWith("/search");
  const wasOnSearchRouteRef = useRef(isSearchRoute);
  const routeSearchQuery = isSearchRoute
    ? normalizePublicSearchTerm(searchParams.get("q") ?? "")
    : "";
  const searchInputValue = isSearchRoute ? routeSearchQuery : searchTerm;
  const searchDisplayQuery = isSearchRoute
    ? routeSearchQuery
    : pendingSearchQuery ?? normalizedSearchTerm;
  const isSearchActive = isSearchRoute
    ? canSearchPublicSongs(routeSearchQuery)
    : normalizedSearchTerm.length > 0;
  const catalogView = useMemo(
    () =>
      getSessionCatalogRoute({
        pathname,
        searchParams: new URLSearchParams(searchParams.toString()),
        sessionToken,
        discovery,
      }),
    [discovery, pathname, searchParams, sessionToken],
  );
  const catalogViewBeforeSearchRef = useRef<SessionCatalogRoute>(catalogView);
  const displayedCatalogView = isSearchRoute ? catalogViewBeforeSearchRef.current : catalogView;

  useEffect(() => {
    if (pathname !== lastPathnameRef.current) {
      hasClientNavigationRef.current = true;
      lastPathnameRef.current = pathname;
    }
  }, [pathname]);

  useEffect(() => {
    if (catalogView.kind !== "catalog" || !catalogView.canonicalHref) return;
    router.replace(catalogView.canonicalHref);
  }, [catalogView, router]);

  useEffect(() => {
    if (!isSearchRoute) catalogViewBeforeSearchRef.current = catalogView;
  }, [catalogView, isSearchRoute]);

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

  const runSearch = useCallback(async (query: string) => {
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    const requestVersion = searchVersionRef.current + 1;
    searchVersionRef.current = requestVersion;

    if (!canSearchPublicSongs(query)) {
      setSearchResults([]);
      setSearchMessage(query ? "Wpisz co najmniej 2 znaki." : null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setSearchMessage(null);
    setSubmitAlert(null);

    try {
      const songs = await searchSessionSongs(sessionToken, query, controller.signal);
      if (controller.signal.aborted || requestVersion !== searchVersionRef.current) return;
      setSearchResults(songs);
      setSearchMessage(songs.length === 0 ? "Nie znaleziono pasujących piosenek." : null);
    } catch (caughtError) {
      if (controller.signal.aborted || isAbortError(caughtError) || requestVersion !== searchVersionRef.current) return;
      setSearchResults([]);
      setSearchMessage("Nie udało się wyszukać piosenek. Spróbuj ponownie.");
    } finally {
      if (!controller.signal.aborted && requestVersion === searchVersionRef.current) setIsSearching(false);
    }
  }, [sessionToken]);

  const navigateToSearch = useCallback((query: string) => {
    const href = `/s/${encodeURIComponent(sessionToken)}/search?${new URLSearchParams({ q: query }).toString()}`;
    setPendingSearchQuery(query);
    if (lastDispatchedSearchQueryRef.current !== query) {
      lastDispatchedSearchQueryRef.current = query;
      void runSearch(query);
    }
    if (isSearchRoute) {
      router.replace(href);
    } else {
      enteredSearchFromSessionRef.current = true;
      router.push(href);
    }
  }, [isSearchRoute, router, runSearch, sessionToken]);

  useEffect(() => {
    if (!isSearchRoute) {
      if (wasOnSearchRouteRef.current) {
        lastDispatchedSearchQueryRef.current = null;
        const clearStaleSearchState = window.setTimeout(() => {
          setSearchTerm("");
          setPendingSearchQuery(null);
          setSearchResults([]);
          setSearchMessage(null);
          setIsSearching(false);
          restoreCatalogScrollPosition();
        }, 0);
        wasOnSearchRouteRef.current = false;
        return () => window.clearTimeout(clearStaleSearchState);
      }
      wasOnSearchRouteRef.current = false;
      return;
    }

    wasOnSearchRouteRef.current = true;

    if (!canSearchPublicSongs(routeSearchQuery)) {
      searchControllerRef.current?.abort();
      searchVersionRef.current += 1;
      router.replace(`/s/${encodeURIComponent(sessionToken)}`);
      return;
    }

    if (lastDispatchedSearchQueryRef.current === routeSearchQuery) return;
    lastDispatchedSearchQueryRef.current = routeSearchQuery;
    void runSearch(routeSearchQuery);
  }, [isSearchRoute, routeSearchQuery, router, runSearch, sessionToken]);

  useEffect(() => {
    if (!shouldDebounceSearchRef.current || !canSearchPublicSongs(normalizedSearchTerm)) {
      return;
    }
    shouldDebounceSearchRef.current = false;
    searchDebounceRef.current = window.setTimeout(() => {
      searchDebounceRef.current = null;
      navigateToSearch(normalizedSearchTerm);
    }, 250);
    return () => {
      if (searchDebounceRef.current !== null) window.clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    };
  }, [navigateToSearch, normalizedSearchTerm]);

  useEffect(() => () => {
    searchControllerRef.current?.abort();
    if (searchDebounceRef.current !== null) window.clearTimeout(searchDebounceRef.current);
  }, []);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = normalizePublicSearchTerm(searchTerm);
    if (canSearchPublicSongs(query)) {
      if (searchDebounceRef.current !== null) window.clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
      shouldDebounceSearchRef.current = false;
      navigateToSearch(query);
    }
  }

  function handleSearchTermChange(value: string) {
    const query = normalizePublicSearchTerm(value);
    if (query && !isSearchRoute) captureCatalogScrollPosition();
    setSearchTerm(value);
    shouldDebounceSearchRef.current = true;
    if (searchDebounceRef.current !== null) window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = null;
    searchControllerRef.current?.abort();
    searchVersionRef.current += 1;
    if (!canSearchPublicSongs(query)) {
      shouldDebounceSearchRef.current = false;
      setSearchResults([]);
      setSearchMessage(query ? "Wpisz co najmniej 2 znaki." : null);
      setIsSearching(false);
    } else {
      setSearchResults([]);
      setSearchMessage(null);
      setIsSearching(true);
    }
    if (!query) clearSearchResults();
  }

  function selectSong(song: PublicSong) {
    setSelectedSong(song);
    setSubmitAlert(null);
    setIsSongDetailsOpen(true);
  }

  function clearSearchResults() {
    searchControllerRef.current?.abort();
    searchVersionRef.current += 1;
    setSearchTerm("");
    setPendingSearchQuery(null);
    setSearchResults([]);
    setSearchMessage(null);
    setSelectedSong(null);
    setIsSongDetailsOpen(false);
    setSubmitAlert(null);
    if (enteredSearchFromSessionRef.current) {
      enteredSearchFromSessionRef.current = false;
      router.back();
      return;
    }
    if (isSearchRoute) {
      router.replace(`/s/${encodeURIComponent(sessionToken)}`);
      return;
    }
    restoreCatalogScrollPosition();
  }

  function captureCatalogScrollPosition() {
    if (typeof window === "undefined" || searchScrollPositionRef.current) return;
    searchScrollPositionRef.current = {
      main: mainScrollRef.current?.scrollTop ?? 0,
      page: window.scrollY,
    };
  }

  function restoreCatalogScrollPosition() {
    const position = searchScrollPositionRef.current;
    if (typeof window === "undefined" || !position) return;
    searchScrollPositionRef.current = null;
    window.requestAnimationFrame(() => {
      if (typeof mainScrollRef.current?.scrollTo === "function") {
        mainScrollRef.current.scrollTo({ top: position.main });
      }
      window.scrollTo(0, position.page);
    });
  }

  async function submitSelectedSong() {
    if (isSubmitting || !selectedSong) return;
    setSubmitAlert(null);
    setIsSubmitting(true);

    try {
      const invalidationVersion = realtimeInvalidationVersionRef.current;
      await createSessionRequest(sessionToken, { songId: selectedSong.id });
      clearSearchResults();
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

  function openQueue() {
    setIsSongDetailsOpen(false);
    setIsQueueOpen(true);
  }

  function handleQueueOpenChange(open: boolean) {
    if (open) {
      openQueue();
      return;
    }

    setIsQueueOpen(false);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SessionShellHeader
            isSubmitting={isSubmitting}
            onOpenProfile={() => {
              setRenameValue(displayName);
              setRenameMessage(null);
              setIsProfileOpen(true);
            }}
            onSearch={handleSearch}
            onSearchTermChange={handleSearchTermChange}
            onOpenQueue={openQueue}
            searchTerm={searchInputValue}
            showQueue={canViewPublicQueue || Boolean(participantDisplayName)}
          />
          <main className="session-scrollbar min-w-0 flex-1 pb-[calc(5.75rem+env(safe-area-inset-bottom))] lg:overflow-y-auto lg:overscroll-contain lg:pb-0" ref={mainScrollRef}>
            <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 lg:max-w-6xl">
      {capabilities.allSessionFeaturesDisabled ? (
        <section className="mb-7">
          <h2 className="mb-2 text-xl font-bold tracking-[-0.035em]">Sesja wydarzenia</h2>
          <SessionStateAlert kind="queue_disabled" />
        </section>
      ) : null}

      {canSubmitSongRequests ? (
        <section aria-label="Wyszukiwanie piosenek" className="mb-7">
          <div hidden={isSearchActive}>
            {displayedCatalogView.kind === "discovery" && discovery ? (
              <SessionDiscoveryHome discovery={discovery} onSongSelect={selectSong} sessionToken={sessionToken} />
            ) : null}
            {displayedCatalogView.kind === "genres" && discovery ? (
              <SessionCatalogGenres genres={discovery.genres} onBack={() => navigateBack(router, `/s/${encodeURIComponent(sessionToken)}`, hasClientNavigationRef.current)} sessionToken={sessionToken} />
            ) : null}
            {displayedCatalogView.kind === "collections" ? (
              <SessionCatalogCollections
                onBack={() => navigateBack(router, `/s/${encodeURIComponent(sessionToken)}`, hasClientNavigationRef.current)}
                section={displayedCatalogView.section}
                sessionToken={sessionToken}
              />
            ) : null}
            {displayedCatalogView.kind === "playlist" && displayedCatalogView.filterKey ? (
              <CatalogCollectionSongList
                filterKey={displayedCatalogView.filterKey}
                onBack={() => navigateBack(router, displayedCatalogView.fallbackHref, hasClientNavigationRef.current)}
                onSongSelect={selectSong}
                sessionToken={sessionToken}
              />
            ) : null}
            {displayedCatalogView.kind === "playlist" && !displayedCatalogView.filterKey ? (
              <CatalogCollectionUnavailable
                onBack={() => navigateBack(router, displayedCatalogView.fallbackHref, hasClientNavigationRef.current)}
              />
            ) : null}
            {displayedCatalogView.kind === "catalog" ? (
              <CatalogSongList
                backLabel={displayedCatalogView.backLabel}
                heading={displayedCatalogView.heading}
                input={displayedCatalogView.input}
                onBack={() => navigateBack(router, displayedCatalogView.fallbackHref, hasClientNavigationRef.current)}
                onSongSelect={selectSong}
                sessionToken={sessionToken}
              />
            ) : null}
          </div>
          {isSearchActive ? (
            <SessionSearchResults
              isLoading={isSearching}
              message={searchMessage}
              onBack={clearSearchResults}
              onSongSelect={selectSong}
               query={searchDisplayQuery}
              songs={searchResults}
            />
          ) : null}
        </section>
      ) : null}

            </div>
          </main>
        </div>
      {canViewPublicQueue || participantDisplayName ? (
        <SessionQueuePanel
          message={queueMessage}
          onOpen={openQueue}
          onOpenChange={handleQueueOpenChange}
          onRefresh={() => void refreshQueue()}
          cancellingRequestId={cancellingRequestId}
          cancelDialogRequestId={cancelDialogRequestId}
          onCancelDialogRequestIdChange={setCancelDialogRequestId}
          onCancelParticipantRequest={(requestId) => void handleCancel(requestId)}
          onParticipantRefresh={() => void loadParticipantRequests()}
          participantDisplayName={displayName || undefined}
          participantRequests={participantRequests}
          participantRequestsMessage={participantRequestsMessage}
          open={isQueueOpen}
          queue={queue}
          refreshing={isRefreshingQueue}
        />
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

function navigateBack(
  router: ReturnType<typeof useRouter>,
  fallbackHref: string,
  hasClientNavigation: boolean,
) {
  if (hasClientNavigation) {
    router.back();
    return;
  }
  router.push(fallbackHref);
}
