// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CatalogSongList } from "@/components/public/catalog-song-list";

const { browseSongs } = vi.hoisted(() => ({ browseSongs: vi.fn() }));

vi.mock("@/components/public/session-api", () => ({
  browseSessionSongs: browseSongs,
}));

const firstSong = {
  id: 1,
  source: "karafun" as const,
  title: "First Song",
  artist: "First Artist",
  durationSeconds: null,
  genres: ["Rock"],
  languages: [],
  isDuet: false,
  isExplicit: false,
  isPlus: false,
  isHit: false,
};

describe("CatalogSongList", () => {
  beforeEach(() => browseSongs.mockReset());

  it("loads a bounded first page, appends exactly one cursor page, and de-duplicates songs", async () => {
    browseSongs
      .mockResolvedValueOnce({ items: [firstSong], nextCursor: "opaque-cursor" })
      .mockResolvedValueOnce({ items: [firstSong, { ...firstSong, id: 2, title: "Second Song" }], nextCursor: null });
    render(<CatalogSongList backLabel="Wróć" heading="Rock" input={{ genre: "Rock" }} onBack={vi.fn()} onSongSelect={vi.fn()} sessionToken="token" />);

    expect(await screen.findByText("First Song")).toBeVisible();
    expect(browseSongs).toHaveBeenLastCalledWith("token", { genre: "Rock", limit: 24 }, expect.any(AbortSignal));
    fireEvent.click(screen.getByRole("button", { name: "Załaduj więcej" }));
    expect(await screen.findByText("Second Song")).toBeVisible();
    expect(browseSongs).toHaveBeenCalledTimes(2);
    expect(browseSongs).toHaveBeenLastCalledWith("token", { genre: "Rock", cursor: "opaque-cursor", limit: 24 }, expect.any(AbortSignal));
    expect(screen.getAllByText("First Song")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Załaduj więcej" })).not.toBeInTheDocument();
  });

  it("retains loaded songs and retries a failed next page", async () => {
    browseSongs
      .mockResolvedValueOnce({ items: [firstSong], nextCursor: "opaque-cursor" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [{ ...firstSong, id: 2, title: "Second Song" }], nextCursor: null });
    render(<CatalogSongList backLabel="Wróć" heading="Rock" input={{ genre: "Rock" }} onBack={vi.fn()} onSongSelect={vi.fn()} sessionToken="token" />);

    await screen.findByText("First Song");
    fireEvent.click(screen.getByRole("button", { name: "Załaduj więcej" }));
    expect(await screen.findByText("Nie udało się wczytać kolejnych utworów.")).toBeVisible();
    expect(screen.getByText("First Song")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    await waitFor(() => expect(screen.getByText("Second Song")).toBeVisible());
  });

  it("cancels a stale initial page when the catalog input changes", async () => {
    type SongPage = { items: Array<typeof firstSong>; nextCursor: null };
    let resolveFirst!: (value: SongPage) => void;
    let resolveSecond!: (value: SongPage) => void;
    const first = new Promise<SongPage>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<SongPage>((resolve) => { resolveSecond = resolve; });
    browseSongs.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { rerender } = render(<CatalogSongList backLabel="Wróć" heading="Rock" input={{ genre: "Rock" }} onBack={vi.fn()} onSongSelect={vi.fn()} sessionToken="token" />);

    await waitFor(() => expect(browseSongs).toHaveBeenCalledOnce());
    const firstSignal = browseSongs.mock.calls[0]?.[2] as AbortSignal;
    rerender(<CatalogSongList backLabel="Wróć" heading="Hity" input={{ hit: true }} onBack={vi.fn()} onSongSelect={vi.fn()} sessionToken="token" />);
    await waitFor(() => expect(browseSongs).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);

    resolveSecond({ items: [{ ...firstSong, id: 2, title: "Newest Song" }], nextCursor: null });
    resolveFirst({ items: [firstSong], nextCursor: null });
    expect(await screen.findByText("Newest Song")).toBeVisible();
    expect(screen.queryByText("First Song")).not.toBeInTheDocument();
  });

  it("does not refetch a loaded catalog for equivalent input props", async () => {
    browseSongs.mockResolvedValue({ items: [firstSong], nextCursor: null });
    const onSongSelect = vi.fn();
    const { rerender } = render(<CatalogSongList backLabel="Wróć" heading="Rock" input={{ genre: "Rock" }} onBack={vi.fn()} onSongSelect={onSongSelect} sessionToken="token" />);

    expect(await screen.findByText("First Song")).toBeVisible();
    rerender(<CatalogSongList backLabel="Wróć" heading="Rock · kolejka otwarta" input={{ genre: "Rock" }} onBack={vi.fn()} onSongSelect={onSongSelect} sessionToken="token" />);
    expect(screen.getByText("First Song")).toBeVisible();
    expect(browseSongs).toHaveBeenCalledOnce();
  });

  it("covers empty, initial-error, and retry states", async () => {
    browseSongs
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [firstSong], nextCursor: null });
    const { rerender } = render(<CatalogSongList backLabel="Wróć" heading="Rock" input={{ genre: "Rock" }} onBack={vi.fn()} onSongSelect={vi.fn()} sessionToken="token" />);

    expect(await screen.findByText("Nie znaleziono pasujących piosenek.")).toBeVisible();
    rerender(<CatalogSongList backLabel="Wróć" heading="Rock" input={{ genre: "Rock" }} onBack={vi.fn()} onSongSelect={vi.fn()} sessionToken="another-token" />);
    expect(await screen.findByText("Nie udało się wczytać katalogu. Spróbuj ponownie.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(await screen.findByText("First Song")).toBeVisible();
  });
});
