// @vitest-environment jsdom

import { readFileSync } from "node:fs";

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PublicSong } from "@/components/public/api";
import { SessionDiscoveryHome } from "@/components/public/session-discovery-home";
import { SessionQueueList } from "@/components/public/session-queue-list";
import {
  getSongArtworkRecipe,
  getSongArtworkSeed,
  SessionSongArtwork,
} from "@/components/public/session-song-artwork";
import { SessionSearchResults } from "@/components/public/session-search-results";
import { SongDetailsDrawer } from "@/components/public/song-details-drawer";

const song: PublicSong = {
  artist: "Bajm",
  durationSeconds: 241,
  id: 44,
  isDuet: false,
  isExplicit: false,
  isHit: true,
  isPlus: false,
  source: "karafun",
  title: "Biała armia",
};

describe("SessionSongArtwork", () => {
  it("keeps a known public-song seed and recipe stable", () => {
    expect(getSongArtworkSeed(song)).toBe("karafun|44|biała armia|bajm");
    expect(getSongArtworkRecipe(song).id).toBe("indigo-radio");
  });

  it("uses source plus sourceSongId when that identity is available", () => {
    expect(
      getSongArtworkSeed({ ...song, id: 900, sourceSongId: "KF-123" }),
    ).toBe("karafun:KF-123");
  });

  it("maps equal songs to an equal recipe and varied songs to valid recipes", () => {
    const songs = [
      song,
      { ...song, id: 45, source: "ising" as const, title: "Za zdrowie pań" },
      { ...song, id: 46, source: "manual" as const, title: "Niebo za rogiem" },
    ];

    expect(getSongArtworkRecipe(song)).toEqual(getSongArtworkRecipe({ ...song }));
    expect(new Set(songs.map((item) => getSongArtworkRecipe(item).id)).size).toBeGreaterThan(1);
    for (const item of songs) expect(getSongArtworkRecipe(item).id).toMatch(/^[a-z-]+$/);
  });

  it("does not let list order affect a song recipe", () => {
    const original = [song, { ...song, id: 45, title: "Ta sama chwila" }];
    const reversed = [...original].reverse();

    expect(original.map(getSongArtworkRecipe)).toEqual(reversed.reverse().map(getSongArtworkRecipe));
  });

  it("renders as decorative artwork without duplicating the surrounding song name", () => {
    const { container } = render(<SessionSongArtwork className="size-14" song={song} />);
    const artwork = container.querySelector("[data-song-artwork]");

    expect(artwork).toHaveAttribute("aria-hidden", "true");
    expect(artwork).not.toHaveAttribute("role", "img");
    expect(artwork).toHaveAttribute("data-artwork-recipe");
  });

  it("uses no random generator", () => {
    expect(readFileSync("src/components/public/session-song-artwork.tsx", "utf8")).not.toContain("Math.random");
  });

  it("is shared by search, discovery, song details, and queue contexts", () => {
    const discovery = {
      features: { duetCount: 0, hitCount: 1, plusCount: 0 },
      genres: [],
      languages: [],
    };
    const queue = {
      enabled: true,
      items: [{ artist: song.artist, createdAt: "2026-09-16T18:00:00.000Z", id: 1, position: 1, singerName: "Ala", status: "now" as const, title: song.title }],
      showSongTitles: true,
    };

    const search = render(<SessionSearchResults isLoading={false} message={null} onBack={vi.fn()} onSongSelect={vi.fn()} query="Bajm" songs={[song]} />);
    expect(search.container.querySelector("[data-song-artwork]")).toBeTruthy();
    search.unmount();

    const discoveryView = render(<SessionDiscoveryHome discovery={discovery} initialSongSections={{ hits: [song], newest: [song] }} onSongSelect={vi.fn()} sessionToken="fixture" />);
    expect(discoveryView.container.querySelectorAll("[data-song-artwork]").length).toBeGreaterThan(0);
    discoveryView.unmount();

    const queueView = render(<SessionQueueList message={null} onRefresh={vi.fn()} queue={queue} refreshing={false} />);
    expect(queueView.container.querySelectorAll("[data-song-artwork]").length).toBeGreaterThan(0);
    queueView.unmount();

    const drawer = render(<SongDetailsDrawer alert={null} isOpen isSubmitting={false} onOpenChange={vi.fn()} onSubmit={vi.fn()} song={song} />);
    expect(drawer.baseElement.querySelector("[data-song-artwork]")).toBeTruthy();
  });
});
