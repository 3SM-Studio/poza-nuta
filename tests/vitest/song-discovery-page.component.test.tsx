// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SongDiscoveryPage,
  SongDiscoveryTeaser,
} from "@/components/public/song-discovery-page";

const {
  browseSongs,
  createRequest,
  routerReplace,
  toastSuccess,
  toastError,
  navigationState,
} = vi.hoisted(() => ({
  browseSongs: vi.fn(),
  createRequest: vi.fn(),
  routerReplace: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  navigationState: { searchParams: new URLSearchParams() },
}));

vi.mock("@/components/public/session-api", () => ({
  browseSessionSongs: browseSongs,
  createSessionRequest: createRequest,
  SessionClientError: class SessionClientError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/s/AbCdEfGhIjKlMnOpQrStUv/songs",
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const discovery = {
  genres: [
    { value: "pop", label: "Pop", count: 120 },
    { value: "rock", label: "Rock", count: 80 },
  ],
  languages: [{ value: "english", label: "English", count: 150 }],
  features: { duetCount: 10, hitCount: 15, plusCount: 0 },
};

const firstSong = {
  id: 1,
  source: "manual" as const,
  title: "First Song",
  artist: "First Artist",
  durationSeconds: null,
  genres: ["Pop"],
  languages: ["English"],
  isDuet: false,
  isExplicit: false,
  isPlus: false,
  isHit: true,
};

const secondSong = {
  ...firstSong,
  id: 2,
  title: "Second Song",
  artist: "Second Artist",
  isHit: false,
};

describe("participant song discovery", () => {
  beforeEach(() => {
    browseSongs.mockReset();
    createRequest.mockReset();
    routerReplace.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    navigationState.searchParams = new URLSearchParams();
    browseSongs.mockResolvedValue({ items: [firstSong], nextCursor: null });
  });

  it("renders dynamic discovery links from usable metadata", () => {
    render(
      <SongDiscoveryTeaser
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        discovery={discovery}
      />,
    );

    expect(screen.getByRole("link", { name: "Hity" })).toHaveAttribute(
      "href",
      "/s/AbCdEfGhIjKlMnOpQrStUv/songs?hit=true",
    );
    expect(screen.getByRole("link", { name: "Duety" })).toHaveAttribute(
      "href",
      "/s/AbCdEfGhIjKlMnOpQrStUv/songs?duet=true",
    );
    expect(screen.getByRole("link", { name: "Pop" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Przeglądaj wszystkie piosenki" }),
    ).toBeVisible();
  });

  it("keeps filters and search in URL state and can clear them", async () => {
    const { rerender } = render(
      <SongDiscoveryPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        discovery={discovery}
      />,
    );
    await screen.findByText("First Song");

    fireEvent.change(screen.getByLabelText("Gatunek"), {
      target: { value: "pop" },
    });
    await waitFor(() =>
      expect(routerReplace).toHaveBeenLastCalledWith(
        "/s/AbCdEfGhIjKlMnOpQrStUv/songs?genre=pop",
        { scroll: false },
      ),
    );
    navigationState.searchParams = new URLSearchParams("genre=pop");
    rerender(
      <SongDiscoveryPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        discovery={discovery}
      />,
    );
    await waitFor(() =>
      expect(browseSongs).toHaveBeenLastCalledWith(
        "AbCdEfGhIjKlMnOpQrStUv",
        expect.objectContaining({ genre: "pop", limit: 24 }),
        expect.any(AbortSignal),
      ),
    );

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Queen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Szukaj" }));
    await waitFor(() =>
      expect(routerReplace).toHaveBeenLastCalledWith(
        "/s/AbCdEfGhIjKlMnOpQrStUv/songs?q=Queen&genre=pop",
        { scroll: false },
      ),
    );
    navigationState.searchParams = new URLSearchParams("q=Queen&genre=pop");
    rerender(
      <SongDiscoveryPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        discovery={discovery}
      />,
    );
    await waitFor(() =>
      expect(browseSongs).toHaveBeenLastCalledWith(
        "AbCdEfGhIjKlMnOpQrStUv",
        expect.objectContaining({ q: "Queen", genre: "pop" }),
        expect.any(AbortSignal),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Wyczyść filtry" }));
    await waitFor(() =>
      expect(routerReplace).toHaveBeenLastCalledWith(
        "/s/AbCdEfGhIjKlMnOpQrStUv/songs",
        { scroll: false },
      ),
    );
    navigationState.searchParams = new URLSearchParams();
    rerender(
      <SongDiscoveryPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        discovery={discovery}
      />,
    );
    await waitFor(() =>
      expect(browseSongs).toHaveBeenLastCalledWith(
        "AbCdEfGhIjKlMnOpQrStUv",
        expect.objectContaining({
          q: null,
          genre: null,
          language: null,
          duet: false,
          hit: false,
          sort: "title",
        }),
        expect.any(AbortSignal),
      ),
    );
  });

  it("keeps the newest browse response when requests resolve out of order", async () => {
    const first = deferred<{ items: (typeof firstSong)[]; nextCursor: null }>();
    const second = deferred<{ items: (typeof secondSong)[]; nextCursor: null }>();
    browseSongs
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { rerender } = render(
      <SongDiscoveryPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        discovery={discovery}
      />,
    );

    fireEvent.change(screen.getByLabelText("Sortowanie"), {
      target: { value: "artist" },
    });
    await waitFor(() =>
      expect(routerReplace).toHaveBeenLastCalledWith(
        "/s/AbCdEfGhIjKlMnOpQrStUv/songs?sort=artist",
        { scroll: false },
      ),
    );
    navigationState.searchParams = new URLSearchParams("sort=artist");
    rerender(
      <SongDiscoveryPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        discovery={discovery}
      />,
    );
    await waitFor(() => expect(browseSongs).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve({ items: [secondSong], nextCursor: null });
      await second.promise;
    });
    expect(await screen.findByText("Second Song")).toBeVisible();

    await act(async () => {
      first.resolve({ items: [firstSong], nextCursor: null });
      await first.promise;
    });
    expect(screen.queryByText("First Song")).not.toBeInTheDocument();
    expect(screen.getByText("Second Song")).toBeVisible();
  });

  it("loads the next bounded page and presents empty and error states", async () => {
    browseSongs
      .mockResolvedValueOnce({ items: [firstSong], nextCursor: "next-page" })
      .mockResolvedValueOnce({ items: [secondSong], nextCursor: null });
    render(
      <SongDiscoveryPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        discovery={discovery}
      />,
    );

    expect(await screen.findByText("First Song")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Pokaż więcej" }));
    expect(await screen.findByText("Second Song")).toBeVisible();
    expect(
      browseSongs.mock.calls[1]?.[1],
    ).toMatchObject({ cursor: "next-page", limit: 24 });
    expect(screen.getByText("To już wszystkie pasujące piosenki.")).toBeVisible();
  });

  it("cancels an in-flight next page when the URL changes", async () => {
    const nextPage = deferred<{ items: (typeof secondSong)[]; nextCursor: null }>();
    browseSongs
      .mockResolvedValueOnce({ items: [firstSong], nextCursor: "next-page" })
      .mockImplementationOnce(() => nextPage.promise)
      .mockResolvedValueOnce({ items: [secondSong], nextCursor: null });
    const { rerender } = render(
      <SongDiscoveryPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        discovery={discovery}
      />,
    );

    expect(await screen.findByText("First Song")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Pokaż więcej" }));
    await waitFor(() => expect(browseSongs).toHaveBeenCalledTimes(2));
    const abortedSignal = browseSongs.mock.calls[1]?.[2] as AbortSignal;

    navigationState.searchParams = new URLSearchParams("hit=true");
    rerender(
      <SongDiscoveryPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        discovery={discovery}
      />,
    );

    await waitFor(() => expect(abortedSignal.aborted).toBe(true));
    await act(async () => {
      nextPage.resolve({ items: [secondSong], nextCursor: null });
      await nextPage.promise;
    });
    expect(screen.queryByText("First Song")).not.toBeInTheDocument();
    expect(await screen.findByText("Second Song")).toBeVisible();
  });

  it("shows an empty state and a recoverable catalog error", async () => {
    browseSongs.mockResolvedValueOnce({ items: [], nextCursor: null });
    const { rerender } = render(
      <SongDiscoveryPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        discovery={discovery}
      />,
    );
    expect(await screen.findByText("Brak pasujących piosenek")).toBeVisible();

    browseSongs.mockRejectedValueOnce(new Error("network"));
    rerender(
      <SongDiscoveryPage
        sessionToken="SecondTokenAbCdEfGhIjKlMn"
        discovery={discovery}
      />,
    );
    expect(
      await screen.findByText("Nie udało się wczytać katalogu. Spróbuj ponownie."),
    ).toBeVisible();
  });

  it("submits through the canonical request API and preserves duplicate feedback", async () => {
    createRequest.mockResolvedValueOnce({ request: { id: "request", status: "pending" } });
    render(
      <SongDiscoveryPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        discovery={discovery}
      />,
    );
    await screen.findByText("First Song");

    fireEvent.click(screen.getByRole("button", { name: "Zgłoś" }));
    await waitFor(() =>
      expect(createRequest).toHaveBeenCalledWith("AbCdEfGhIjKlMnOpQrStUv", {
        songId: 1,
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Dodano zgłoszenie", {
      description: "Operator musi je zatwierdzić.",
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Zgłoś" })).not.toBeDisabled(),
    );

    const { SessionClientError } = await import("@/components/public/session-api");
    createRequest.mockRejectedValueOnce(
      new SessionClientError(409, "SESSION_REQUEST_DUPLICATE", "duplicate"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Zgłoś" }));
    expect(await screen.findByText("To zgłoszenie już czeka")).toBeVisible();
    expect(toastError).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
