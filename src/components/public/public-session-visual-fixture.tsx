"use client";

import { useState, type FormEvent } from "react";

import type { PublicSong } from "./api";
import { ParticipantJoinGate } from "./participant-join-gate";
import { ParticipantProfileDrawer } from "./participant-profile-drawer";
import { SessionQueueList } from "./session-queue-list";
import { SessionSearchResults } from "./session-search-results";
import { SessionDiscoveryHome } from "./session-discovery-home";
import { SessionGenreResults } from "./session-genre-results";
import { SessionShellHeader } from "./session-shell-header";
import { SongDetailsDrawer } from "./song-details-drawer";

export type PublicSessionVisualFixtureState =
  | "pre-join"
  | "main"
  | "discovery"
  | "discovery-loading"
  | "discovery-network"
  | "discovery-minimal"
  | "category-genre-results"
  | "profile"
  | "queue"
  | "queue-current"
  | "search-results"
  | "search-loading"
  | "search-empty"
  | "song-details"
  | "song-details-submitting"
  | "song-details-error"
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
];

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

export function PublicSessionVisualFixture({
  state,
}: {
  state: PublicSessionVisualFixtureState;
}) {
  if (state === "pre-join") {
    return (
      <main className="min-h-dvh bg-background text-foreground">
        <ParticipantJoinGate
          eventName="Noc Mikrofonów · Mokotów"
          sessionToken="visual-fixture-session-token"
        />
      </main>
    );
  }

  return <ParticipantSessionFixture initialState={state} />;
}

function ParticipantSessionFixture({
  initialState,
}: {
  initialState: Exclude<PublicSessionVisualFixtureState, "pre-join">;
}) {
  const [isQueueView, setIsQueueView] = useState(
    initialState === "queue" || initialState === "queue-current",
  );
  const [isProfileOpen, setIsProfileOpen] = useState(initialState === "profile");
  const [isCategoryView, setIsCategoryView] = useState(
    initialState === "category-genre-results",
  );
  const [selectedGenre, setSelectedGenre] = useState(fixtureDiscovery.genres[0]!);
  const [nickname, setNickname] = useState("Ola");
  const isDiscoveryFixture = [
    "main",
    "discovery",
    "discovery-loading",
    "discovery-network",
    "discovery-minimal",
  ].includes(initialState);
  const isSearchFixture = [
    "search-results",
    "search-loading",
    "search-empty",
    "song-details",
    "song-details-submitting",
    "song-details-error",
    "song-details-loading",
    "search-no-results",
  ].includes(initialState);
  const isSearchLoading = initialState === "search-loading";
  const isSearchEmpty =
    initialState === "search-empty" || initialState === "search-no-results";
  const isSongDetailsFixture = [
    "song-details",
    "song-details-submitting",
    "song-details-error",
    "song-details-loading",
  ].includes(initialState);
  const isSongDetailsSubmitting =
    initialState === "song-details-submitting" ||
    initialState === "song-details-loading";
  const [searchTerm, setSearchTerm] = useState(isSearchFixture ? "Abba" : "");
  const [selectedSong, setSelectedSong] = useState<PublicSong | null>(
    isSongDetailsFixture ? fixtureSongs[0] : null,
  );
  const [isSongDetailsOpen, setIsSongDetailsOpen] =
    useState(isSongDetailsFixture);
  const [isAddingSong, setIsAddingSong] = useState(isSongDetailsSubmitting);
  const detailsAlert =
    initialState === "song-details-error" ? "duplicate_request" : null;

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsProfileOpen(false);
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="flex min-h-dvh max-h-dvh flex-col overflow-hidden">
        <SessionShellHeader
          isQueueView={isQueueView}
          isSearching={isSearchLoading}
          isSubmitting={isAddingSong}
          onOpenProfile={() => setIsProfileOpen(true)}
          onSearch={handleSearch}
          onSearchTermChange={setSearchTerm}
          onToggleQueue={() => setIsQueueView((current) => !current)}
          searchTerm={searchTerm}
          showQueue
        />

        <div className={isQueueView ? "flex-1 overflow-y-auto overscroll-contain px-4 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-8" : "hidden"}>
          <SessionQueueList
            message={null}
            onRefresh={() => undefined}
            queue={initialState === "queue-current" ? fixtureQueueCurrent : fixtureQueue}
            refreshing={false}
          />
        </div>

        <div className={isQueueView ? "hidden" : "mx-auto w-full max-w-3xl flex-1 overflow-y-auto overscroll-contain px-4 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-8 lg:max-w-6xl"}>
          {isCategoryView ? (
            <SessionGenreResults
              genre={selectedGenre}
              initialSongs={fixtureSongs}
              onBack={() => setIsCategoryView(false)}
              onSongSelect={(song) => {
                setSelectedSong(song);
                setIsSongDetailsOpen(true);
              }}
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
                setIsSongDetailsOpen(true);
              }}
              onGenreSelect={(genre) => {
                setSelectedGenre(genre);
                setIsCategoryView(true);
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
                setIsSongDetailsOpen(true);
              }}
              query={searchTerm}
              songs={isSearchEmpty || isSearchLoading ? [] : fixtureSongs}
            />
          ) : null}
        </div>

        <SongDetailsDrawer
          alert={detailsAlert}
          artworkClassName="bg-[radial-gradient(circle_at_70%_25%,oklch(0.88_0.2_335_/_75%),transparent_22%),linear-gradient(145deg,oklch(0.53_0.2_326),oklch(0.23_0.1_286))] text-primary-foreground"
          isOpen={isSongDetailsOpen}
          isSubmitting={isAddingSong}
          onOpenChange={setIsSongDetailsOpen}
          onSubmit={() => setIsAddingSong(true)}
          song={selectedSong}
        />

        <ParticipantProfileDrawer
          error={null}
          isOpen={isProfileOpen}
          isSaving={false}
          onOpenChange={setIsProfileOpen}
          onSubmit={handleRename}
          onValueChange={setNickname}
          value={nickname}
        />
      </div>
    </main>
  );
}
