// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionSongRow } from "@/components/public/session-song-row";

const song = {
  artist: "Bardzo długi wykonawca z polskimi znakami",
  durationSeconds: null,
  id: 1,
  isDuet: false,
  isExplicit: false,
  isHit: false,
  isPlus: false,
  source: "ising" as const,
  title: "12 groszy",
};

describe("SessionSongRow", () => {
  it("keeps title and artist in one growing, left-aligned text column", () => {
    render(<SessionSongRow song={song} onSelect={vi.fn()} />);

    const row = screen.getByRole("button", { name: /12 groszy/i });
    const text = row.querySelector('[data-slot="session-song-row-text"]');

    expect(row).toHaveClass("items-center", "text-left");
    expect(text).toHaveClass("flex-1", "min-w-0", "text-left");
    expect(text).toHaveTextContent(song.title);
    expect(text).toHaveTextContent(song.artist);
  });
});
