"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { PublicSong } from "./api";
import { ParticipantJoinGate } from "./participant-join-gate";
import { ParticipantProfileDrawer } from "./participant-profile-drawer";
import { SessionQueueList } from "./session-queue-list";
import { SessionSearchResults } from "./session-search-results";
import { SessionShellHeader } from "./session-shell-header";
import { SongDetailsDrawer } from "./song-details-drawer";

export type PublicSessionVisualFixtureState =
  | "pre-join"
  | "main"
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
  const [nickname, setNickname] = useState("Ola");
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

        <div className={isQueueView ? "hidden" : "mx-auto w-full max-w-3xl flex-1 overflow-y-auto overscroll-contain px-4 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-8"}>
          {isSearchFixture ? (
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
          ) : (
            <>
              <h1 className="mb-1 text-xs font-extrabold tracking-[0.05em] text-muted-foreground uppercase">Wyniki</h1>
              <section aria-label="Przykładowe wyniki" className="border-t border-border">
                {fixtureSongs.slice(0, 3).map((song) => (
                  <button className="grid w-full gap-0.5 border-b border-border px-0.5 py-4 text-left transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" key={song.id} type="button">
                    <span className="text-base font-extrabold leading-snug tracking-[-0.02em]">{song.title}</span>
                    <span className="text-sm text-muted-foreground">{song.artist}</span>
                    <span className="mt-1 text-xs leading-relaxed text-muted-foreground">{song.source}</span>
                  </button>
                ))}
              </section>
              <Button className="mt-5 h-12 w-full rounded-full font-extrabold" type="button">Dodaj do kolejki</Button>
            </>
          )}
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
