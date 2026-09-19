"use client";

import { useState, type FormEvent } from "react";

import type { PublicSong } from "./api";
import { ParticipantJoinGate } from "./participant-join-gate";
import { ParticipantProfileDrawer } from "./participant-profile-drawer";
import { SessionQueuePanel } from "./session-queue-panel";
import { SessionSearchResults } from "./session-search-results";
import { SessionDiscoveryHome } from "./session-discovery-home";
import { SessionCatalogGenres } from "./session-catalog-genres";
import { CatalogSongList } from "./catalog-song-list";
import { SessionShellHeader } from "./session-shell-header";
import { SongDetailsDrawer } from "./song-details-drawer";
import { SessionSongArtwork } from "./session-song-artwork";
import { formatSongSource } from "./validation";
import { JoinCodeGate } from "./join-code-gate";
import { PublicSessionLifecycle } from "./public-session-lifecycle";
import { SessionRequestPage } from "./session-request-page";
import { SessionStateAlert } from "./session-state-alert";

export type PublicSessionVisualFixtureState =
  | "pre-join"
  | "participant-join"
  | "join-initial"
  | "join-invalid"
  | "join-rate-limited"
  | "join-unavailable"
  | "scheduled"
  | "closed"
  | "closed-reopenable"
  | "cancelled"
  | "invalid-session"
  | "service-unavailable"
  | "page-rate-limited"
  | "capabilities-both"
  | "capabilities-requests-only"
  | "capabilities-queue-only"
  | "capabilities-none"
  | "main"
  | "discovery"
  | "discovery-loading"
  | "discovery-network"
  | "discovery-minimal"
  | "category-genre-results"
  | "profile"
  | "queue"
  | "queue-current"
  | "queue-mobile-collapsed"
  | "queue-mobile-expanded"
  | "queue-mobile-long"
  | "queue-mobile-empty"
  | "queue-desktop"
  | "queue-desktop-long"
  | "queue-desktop-empty"
  | "queue-hidden-titles"
  | "search-results"
  | "search-loading"
  | "search-empty"
  | "song-details"
  | "song-details-submitting"
  | "song-details-error"
  | "artwork-gallery"
  | "catalog-genres"
  | "catalog-genre-results"
  | "catalog-genre-loaded-more"
  | "catalog-load-more-loading"
  | "catalog-load-more-error"
  | "catalog-hits"
  | "catalog-newest"
  | "catalog-duets"
  | "catalog-empty"
  | "live-search-loading"
  | "instrumented-search"
  | "queue-my-requests"
  | "queue-my-requests-empty"
  | "long-song-details"
  // Legacy aliases retained for existing visual-fixture links.
  | "song-details-loading"
  | "search-no-results";

const fixtureQueueCurrent = {
  enabled: true,
  showSongTitles: true,
  items: [
    {
      id: 101,
      singerName: "Ola",
      status: "now" as const,
      position: 1,
      createdAt: "2026-09-15T18:00:00.000Z",
      title: "Dancing Queen",
      artist: "ABBA",
    },
    {
      id: 102,
      singerName: "Maks",
      status: "approved" as const,
      position: 2,
      createdAt: "2026-09-15T18:02:00.000Z",
      title: "Zanim pójdę",
      artist: "Happysad",
    },
    {
      id: 103,
      singerName: "Iga",
      status: "approved" as const,
      position: 3,
      createdAt: "2026-09-15T18:04:00.000Z",
      title: "Flowers",
      artist: "Miley Cyrus",
    },
  ],
};

const fixtureQueue = {
  ...fixtureQueueCurrent,
  items: fixtureQueueCurrent.items.map((item) => ({
    ...item,
    status: "approved" as const,
  })),
};

const fixtureQueueEmpty = {
  enabled: true,
  showSongTitles: true,
  items: [],
};

const fixtureParticipantRequests = [
  {
    id: "fixture-request",
    title: "Dancing Queen",
    artist: "ABBA",
    status: "pending" as const,
    queuePosition: null,
    isNext: false,
    createdAt: "2026-09-15T18:00:00.000Z",
  },
];

const fixtureSongs: PublicSong[] = [
  {
    id: 201,
    title: "Dancing Queen",
    artist: "ABBA",
    source: "karafun",
    durationSeconds: 231,
    isDuet: false,
    isExplicit: false,
    isPlus: false,
    isHit: true,
  },
  {
    id: 202,
    title: "Mamma Mia",
    artist: "A*Teens",
    source: "ising",
    durationSeconds: 214,
    isDuet: false,
    isExplicit: false,
    isPlus: false,
    isHit: true,
  },
  {
    id: 203,
    title: "The Winner Takes It All",
    artist: "ABBA",
    source: "karafun",
    durationSeconds: null,
    isDuet: false,
    isExplicit: false,
    isPlus: false,
    isHit: false,
  },
  {
    id: 204,
    title: "Gimme! Gimme! Gimme!",
    artist: "Erasure",
    source: "ising",
    durationSeconds: 289,
    isDuet: false,
    isExplicit: false,
    isPlus: false,
    isHit: false,
  },
  {
    id: 205,
    title: "Waterloo",
    artist: "Cher",
    source: "karafun",
    durationSeconds: 166,
    isDuet: false,
    isExplicit: false,
    isPlus: false,
    isHit: false,
  },
  {
    id: 206,
    title: "Voulez-Vous",
    artist: "ABBA",
    source: "ising",
    durationSeconds: null,
    isDuet: false,
    isExplicit: false,
    isPlus: false,
    isHit: false,
  },
  {
    id: 207,
    title: "Fernando",
    artist: "Anni-Frid Lyngstad",
    source: "karafun",
    durationSeconds: 256,
    isDuet: false,
    isExplicit: false,
    isPlus: false,
    isHit: false,
  },
  {
    id: 208,
    title: "Thank You for the Music (Live at Wembley Arena, London, 1979)",
    artist: "ABBA",
    source: "ising",
    durationSeconds: 298,
    isDuet: false,
    isExplicit: false,
    isPlus: false,
    isHit: false,
  },
  { id: 209, title: "Jesteś szalona", artist: "Boys", source: "manual", durationSeconds: 201, isDuet: false, isExplicit: false, isPlus: false, isHit: true },
  { id: 210, title: "Nie pytaj o Polskę", artist: "Obywatel G.C.", source: "karafun", durationSeconds: 258, isDuet: false, isExplicit: false, isPlus: false, isHit: false },
  { id: 211, title: "Przez Twe Oczy Zielone", artist: "Akcent", source: "ising", durationSeconds: 222, isDuet: false, isExplicit: false, isPlus: false, isHit: true },
  { id: 212, title: "Bądź moim natchnieniem", artist: "Andrzej Zaucha", source: "manual", durationSeconds: 239, isDuet: false, isExplicit: false, isPlus: false, isHit: false },
  { id: 213, title: "Shallow", artist: "Lady Gaga & Bradley Cooper", source: "karafun", durationSeconds: 217, isDuet: true, isExplicit: false, isPlus: false, isHit: true },
  { id: 214, title: "Tyle słońca w całym mieście", artist: "Anna Jantar", source: "ising", durationSeconds: 188, isDuet: false, isExplicit: false, isPlus: false, isHit: false },
  { id: 215, title: "Kocham Cię, kochanie moje", artist: "Maanam", source: "manual", durationSeconds: 247, isDuet: false, isExplicit: false, isPlus: false, isHit: false },
  { id: 216, title: "Blinding Lights", artist: "The Weeknd", source: "karafun", durationSeconds: 200, isDuet: false, isExplicit: false, isPlus: false, isHit: true },
];

const fixtureQueueLong = {
  ...fixtureQueueCurrent,
  items: Array.from({ length: 30 }, (_, index) => {
    const song = fixtureSongs[index % fixtureSongs.length]!;
    return {
      id: 301 + index,
      singerName: ["Ola", "Maks", "Iga", "Tomek"][index % 4]!,
      status: (index === 0 ? "now" : "approved") as "now" | "approved",
      position: index + 1,
      createdAt: `2026-09-15T18:${String(index).padStart(2, "0")}:00.000Z`,
      title: song.title,
      artist: song.artist,
    };
  }),
};

const fixtureDiscovery = {
  genres: [
    { value: "pop", label: "Pop", count: 214 },
    { value: "rock", label: "Rock", count: 168 },
    { value: "dance", label: "Dance", count: 140 },
    { value: "soundtrack", label: "Filmowe", count: 96 },
    { value: "disco", label: "Disco", count: 84 },
    { value: "soul", label: "Soul", count: 68 },
  ],
  languages: [],
  features: { duetCount: 26, hitCount: 48, plusCount: 0 },
};

const fixtureMinimalDiscovery = {
  genres: [],
  languages: [],
  features: { duetCount: 0, hitCount: 0, plusCount: 0 },
};

const fixtureBrowseSongs = fixtureSongs.map((song) => ({
  ...song,
  genres: ["Rock"],
  languages: ["Polski"],
}));

export function PublicSessionVisualFixture({
  state,
}: {
  state: PublicSessionVisualFixtureState;
}) {
  if (state === "pre-join" || state === "participant-join") {
    return (
      <main className="min-h-dvh bg-background text-foreground">
        <ParticipantJoinGate
          eventName="Noc Mikrofonów · Mokotów"
          sessionToken="visual-fixture-session-token"
        />
      </main>
    );
  }

  if (state.startsWith("join-")) {
    const joinError = state === "join-invalid" ? "invalid" : state === "join-rate-limited" ? "rate-limited" : state === "join-unavailable" ? "unavailable" : undefined;
    return <JoinCodeGate joinError={joinError} resolveCode={() => new Promise(() => undefined)} />;
  }

  if (["scheduled", "closed", "closed-reopenable", "cancelled", "invalid-session", "service-unavailable", "page-rate-limited"].includes(state)) {
    const kind = state === "invalid-session" ? "invalid" : state === "service-unavailable" ? "service_unavailable" : state === "page-rate-limited" ? "rate_limited" : state === "scheduled" ? "scheduled" : state === "cancelled" ? "cancelled" : "closed";
    return <PublicSessionLifecycle
      event={state === "invalid-session" || state === "service-unavailable" || state === "page-rate-limited" ? undefined : { name: "Noc Mikrofonów · Mokotów", venue: "Klub Fala", startsAt: "2026-09-20T18:00:00.000Z" }}
      kind={kind}
      reopenable={state === "closed-reopenable"}
    />;
  }

  if (state === "artwork-gallery") {
    return <ArtworkGallery />;
  }

  if (state === "instrumented-search") {
    return (
      <SessionRequestPage
        discovery={fixtureDiscovery}
        event={{
          name: "Noc Mikrofonów · Mokotów",
          venue: "Klub Fala",
          startsAt: "2026-09-19T16:00:00.000Z",
          endsAt: "2026-09-20T02:00:00.000Z",
          status: "active",
          publicQueueEnabled: false,
          songRequestsEnabled: true,
          publicShowSongTitles: true,
          autoCloseAt: "2026-09-20T02:00:00.000Z",
          closedAt: null,
        }}
        sessionToken="visual-fixture-session-token"
      />
    );
  }

  return <ParticipantSessionFixture initialState={state} />;
}

function ArtworkGallery() {
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-8">
      <section aria-labelledby="artwork-gallery-title" className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-extrabold tracking-[-0.045em]" id="artwork-gallery-title">
          Artworki utworów
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Deterministyczne artworki Poza Nutą do wizualnej kontroli jakości.
        </p>
        <div className="mt-7 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {fixtureSongs.slice(0, 16).map((song) => (
            <article className="min-w-0" key={song.id}>
              <SessionSongArtwork className="aspect-square w-full" priority song={song} />
              <h2 className="mt-2 truncate text-sm font-extrabold tracking-[-0.02em]">{song.title}</h2>
              <p className="truncate text-xs text-muted-foreground">{song.artist}</p>
              <p className="mt-1 text-[0.68rem] font-bold tracking-[0.06em] text-primary uppercase">
                {formatSongSource(song.source)}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function ParticipantSessionFixture({
  initialState,
}: {
  initialState: Exclude<PublicSessionVisualFixtureState, "pre-join">;
}) {
  const [isQueueOpen, setIsQueueOpen] = useState(
    ["queue", "queue-current", "queue-mobile-expanded", "queue-mobile-long", "queue-mobile-empty", "queue-my-requests", "queue-my-requests-empty"].includes(initialState),
  );
  const [isProfileOpen, setIsProfileOpen] = useState(initialState === "profile");
  const [nickname, setNickname] = useState("Ola");
  const requestsEnabled = initialState !== "capabilities-queue-only" && initialState !== "capabilities-none";
  const queueEnabled = initialState !== "capabilities-requests-only" && initialState !== "capabilities-none";
  const hasParticipant = initialState !== "capabilities-none";
  const isDiscoveryFixture = [
    "main",
    "discovery",
    "discovery-loading",
    "discovery-network",
    "discovery-minimal",
    "queue",
    "queue-current",
    "queue-mobile-collapsed",
    "queue-mobile-expanded",
    "queue-mobile-long",
    "queue-mobile-empty",
    "queue-desktop",
    "queue-desktop-long",
    "queue-desktop-empty",
    "queue-hidden-titles",
    "capabilities-both",
    "capabilities-requests-only",
  ].includes(initialState);
  const isSearchFixture = [
    "search-results",
    "search-loading",
    "search-empty",
    "live-search-loading",
    "search-no-results",
  ].includes(initialState);
  const isSearchLoading = initialState === "search-loading" || initialState === "live-search-loading";
  const isSearchEmpty =
    initialState === "search-empty" || initialState === "search-no-results";
  const isSongDetailsFixture = [
    "song-details",
    "song-details-submitting",
    "song-details-error",
    "song-details-loading",
    "long-song-details",
  ].includes(initialState);
  const isSongDetailsSubmitting =
    initialState === "song-details-submitting" ||
    initialState === "song-details-loading";
  const [searchTerm, setSearchTerm] = useState(isSearchFixture ? "Abba" : "");
  const [selectedSong, setSelectedSong] = useState<PublicSong | null>(
    isSongDetailsFixture
      ? initialState === "long-song-details"
        ? fixtureSongs[7]
        : fixtureSongs[0]
      : null,
  );
  const [isSongDetailsOpen, setIsSongDetailsOpen] =
    useState(isSongDetailsFixture);
  const [isAddingSong, setIsAddingSong] = useState(isSongDetailsSubmitting);
  const detailsAlert =
    initialState === "song-details-error" ? "duplicate_request" : null;
  const fixtureQueueState = initialState === "queue-hidden-titles"
    ? { ...fixtureQueueCurrent, showSongTitles: false }
    : ["queue-mobile-empty", "queue-desktop-empty"].includes(initialState)
    ? fixtureQueueEmpty
    : ["queue-mobile-long", "queue-desktop-long"].includes(initialState)
      ? fixtureQueueLong
      : initialState === "queue-current" || initialState === "queue-mobile-collapsed" || initialState === "queue-mobile-expanded" || initialState === "queue-desktop"
        ? fixtureQueueCurrent
        : fixtureQueue;

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsProfileOpen(false);
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="flex min-h-dvh flex-col xl:h-dvh xl:min-h-0 xl:overflow-hidden">
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <SessionShellHeader
              isSubmitting={isAddingSong}
              onOpenProfile={() => setIsProfileOpen(true)}
              onSearch={handleSearch}
              onSearchTermChange={setSearchTerm}
              onSearchCompositionStart={() => undefined}
              onSearchCompositionEnd={setSearchTerm}
              onOpenQueue={() => {
                setIsSongDetailsOpen(false);
                setIsQueueOpen(true);
              }}
              queueButtonLabel={queueEnabled ? "Otwórz kolejkę" : "Otwórz moje zgłoszenia"}
              searchTerm={searchTerm}
              showProfile={hasParticipant}
              showQueue={queueEnabled || hasParticipant}
              showSearch={requestsEnabled}
            />

            <main className="session-scrollbar min-w-0 flex-1 pb-[calc(5.75rem+env(safe-area-inset-bottom))] xl:overflow-y-auto xl:overscroll-contain xl:pb-0">
              <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 xl:max-w-6xl">
          {!requestsEnabled && !queueEnabled ? (
            <section className="mx-auto max-w-xl"><h2 className="mb-3 text-2xl font-extrabold tracking-[-0.03em]">Sesja wydarzenia</h2><SessionStateAlert kind="queue_disabled" /></section>
          ) : !requestsEnabled && queueEnabled ? (
            <section className="mx-auto max-w-xl text-center"><h2 className="text-2xl font-extrabold tracking-[-0.03em]">Publiczna kolejka jest dostępna</h2><p className="mt-2 text-sm text-muted-foreground">Otwórz kolejkę na dole ekranu, aby zobaczyć kto śpiewa.</p></section>
          ) : initialState === "catalog-genres" ? (
            <SessionCatalogGenres genres={fixtureDiscovery.genres} onBack={() => undefined} sessionToken="visual-fixture-session-token" />
          ) : initialState.startsWith("catalog-") ? (
            <CatalogSongList
              backLabel="Wróć"
              forceLoadMoreLoading={initialState === "catalog-load-more-loading"}
              heading={initialState === "catalog-hits" ? "Hity" : initialState === "catalog-newest" ? "Najnowsze" : initialState === "catalog-duets" ? "Duety" : "Rock"}
              initialItems={initialState === "catalog-empty" ? [] : fixtureBrowseSongs}
              initialLoadMoreError={initialState === "catalog-load-more-error" ? "Nie udało się wczytać kolejnych utworów." : null}
              initialNextCursor={initialState === "catalog-genre-results" || initialState === "catalog-empty" ? null : "fixture-cursor"}
              input={{ genre: "Rock" }}
              onBack={() => undefined}
              onSongSelect={(song) => { setSelectedSong(song); setIsSongDetailsOpen(true); }}
              sessionToken="visual-fixture-session-token"
            />
          ) : initialState === "category-genre-results" ? (
            <CatalogSongList
              backLabel="Wróć do gatunków"
              heading="Pop"
              initialItems={fixtureBrowseSongs}
              input={{ genre: "pop" }}
              onBack={() => undefined}
              onSongSelect={(song) => { setSelectedSong(song); setIsSongDetailsOpen(true); }}
              sessionToken="visual-fixture-session-token"
            />
          ) : isDiscoveryFixture ? (
            <SessionDiscoveryHome
              discovery={
                initialState === "discovery-minimal"
                  ? fixtureMinimalDiscovery
                  : fixtureDiscovery
              }
              forceLoading={initialState === "discovery-loading"}
              forceMinimal={initialState === "discovery-minimal"}
              initialSongSections={
                initialState === "discovery-loading" ||
                initialState === "discovery-network"
                  ? undefined
                  : {
                      hits: fixtureSongs.slice(0, 6),
                      newest: fixtureSongs.slice(2, 8),
                      duets: fixtureSongs.slice(1, 7),
                    }
              }
              onSongSelect={(song) => {
                setSelectedSong(song);
                setIsQueueOpen(false);
                setIsSongDetailsOpen(true);
              }}
              sessionToken="visual-fixture-session-token"
            />
          ) : isSearchFixture ? (
            <SessionSearchResults
              isLoading={isSearchLoading}
              message={
                isSearchEmpty ? "Nie znaleziono pasujących piosenek." : null
              }
              onBack={() => setSearchTerm("")}
              onSongSelect={(song) => {
                setSelectedSong(song);
                setIsQueueOpen(false);
                setIsSongDetailsOpen(true);
              }}
              query={searchTerm}
              songs={isSearchEmpty || isSearchLoading ? [] : fixtureSongs}
            />
          ) : null}
              </div>
            </main>
          </div>
        {queueEnabled || hasParticipant ? <SessionQueuePanel
          message={null}
          onOpenChange={setIsQueueOpen}
          onRefresh={() => undefined}
          open={isQueueOpen}
          queue={fixtureQueueState}
          refreshing={false}
          defaultTab={initialState === "queue-my-requests" || initialState === "queue-my-requests-empty" || !queueEnabled ? "mine" : "queue"}
          participantDisplayName={hasParticipant ? "Ola" : undefined}
          participantRequests={initialState === "queue-my-requests-empty" ? [] : fixtureParticipantRequests}
          participantRequestsMessage={null}
          showPublicQueue={queueEnabled}
        /> : null}
        </div>

        <SongDetailsDrawer
          alert={detailsAlert}
          isOpen={isSongDetailsOpen}
          isSubmitting={isAddingSong}
          onOpenChange={setIsSongDetailsOpen}
          onSubmit={() => setIsAddingSong(true)}
          song={selectedSong}
        />

        {hasParticipant ? <ParticipantProfileDrawer
          error={null}
          isOpen={isProfileOpen}
          isSaving={false}
          onOpenChange={setIsProfileOpen}
          onSubmit={handleRename}
          onValueChange={setNickname}
          value={nickname}
        /> : null}
      </div>
    </div>
  );
}
