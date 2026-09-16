// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionDiscoveryHome } from "@/components/public/session-discovery-home";

const songs = [
  {
    id: 1,
    source: "karafun" as const,
    title: "Dancing Queen",
    artist: "ABBA",
    durationSeconds: 231,
    isDuet: false,
    isExplicit: false,
    isPlus: false,
    isHit: true,
  },
  {
    id: 2,
    source: "ising" as const,
    title: "Shallow",
    artist: "Lady Gaga",
    durationSeconds: 215,
    isDuet: true,
    isExplicit: false,
    isPlus: false,
    isHit: false,
  },
];

const discovery = {
  genres: [
    { value: "pop", label: "Pop", count: 120 },
    { value: "rock", label: "Rock", count: 80 },
  ],
  languages: [{ value: "english", label: "English", count: 150 }],
  features: { duetCount: 10, hitCount: 15, plusCount: 0 },
};

describe("session discovery home", () => {
  it("maps only real genre, hit, newest, and duet data into carousel sections", () => {
    render(
      <SessionDiscoveryHome
        discovery={discovery}
        initialSongSections={{ hits: songs, newest: songs, duets: songs.slice(1) }}
        onSongSelect={vi.fn()}
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
      />,
    );

    expect(screen.getByRole("heading", { name: "Gatunki" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Hity" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Najnowsze" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Duety" })).toBeVisible();
    expect(screen.queryByText("Playlisty")).not.toBeInTheDocument();
    expect(screen.queryByText("Popularne")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pop, 120 piosenek" })).toHaveAttribute(
      "href",
      "/s/AbCdEfGhIjKlMnOpQrStUv/catalog?filter=genre%3Apop",
    );
    expect(screen.getByRole("link", { name: "Zobacz więcej: Najnowsze" })).toHaveAttribute(
      "href",
      "/s/AbCdEfGhIjKlMnOpQrStUv/catalog?filter=newest",
    );
  });

  it("keeps the cards keyboard-focusable and selects a song through its button", () => {
    const onSongSelect = vi.fn();
    render(
      <SessionDiscoveryHome
        discovery={discovery}
        initialSongSections={{ hits: songs, newest: songs, duets: songs }}
        onSongSelect={onSongSelect}
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
      />,
    );

    const card = screen.getAllByRole("button", { name: "Dancing Queen — ABBA" })[0];
    card?.focus();
    expect(card).toHaveFocus();
    fireEvent.click(card!);
    expect(onSongSelect).toHaveBeenCalledWith(songs[0]);
    expect(screen.getAllByRole("button", { name: "Następne elementy" }).length).toBeGreaterThan(0);
  });

  it("uses loading geometry and a real minimal state when optional metadata is absent", () => {
    const { rerender } = render(
      <SessionDiscoveryHome
        discovery={discovery}
        forceLoading
        onSongSelect={vi.fn()}
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
      />,
    );

    expect(screen.getByLabelText("Wczytywanie sekcji Hity")).toBeVisible();
    expect(screen.getByLabelText("Wczytywanie sekcji Najnowsze")).toBeVisible();

    rerender(
      <SessionDiscoveryHome
        discovery={{
          genres: [],
          languages: [],
          features: { duetCount: 0, hitCount: 0, plusCount: 0 },
        }}
        forceMinimal
        onSongSelect={vi.fn()}
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
      />,
    );

    expect(screen.getByRole("heading", { name: "Odkrywaj katalog" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Przeglądaj piosenki" })).toHaveAttribute(
      "href",
      "/s/AbCdEfGhIjKlMnOpQrStUv/catalog/genres",
    );
  });
});
