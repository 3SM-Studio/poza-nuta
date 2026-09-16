// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionRequestPage } from "@/components/public/session-request-page";
import type { QueueRealtimeInvalidateReason } from "@/lib/queue-realtime";

const {
  createRequest,
  getParticipantRequests,
  cancelParticipantRequest,
  renameParticipant,
  getEvent,
  getQueue,
  realtime,
  refreshRouter,
  routerBack,
  routerPush,
  navigationState,
  searchSongs,
  browseSongs,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
    createRequest: vi.fn(),
    getParticipantRequests: vi.fn(),
    cancelParticipantRequest: vi.fn(),
    renameParticipant: vi.fn(),
    getEvent: vi.fn(),
    getQueue: vi.fn(),
    realtime: {
      onInvalidate: null as
        | ((
            reason: QueueRealtimeInvalidateReason,
            signal: AbortSignal,
          ) => void | Promise<void>)
        | null,
    },
    refreshRouter: vi.fn(),
    routerBack: vi.fn(),
    routerPush: vi.fn(),
    navigationState: {
      pathname: "/s/AbCdEfGhIjKlMnOpQrStUv",
      searchParams: new URLSearchParams(),
    },
    searchSongs: vi.fn(),
    browseSongs: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  }));

vi.mock("@/components/public/session-api", () => ({
  cancelParticipantRequest,
  createSessionRequest: createRequest,
  getParticipantRequests,
  getSessionEvent: getEvent,
  getSessionQueue: getQueue,
  renameSessionParticipant: renameParticipant,
  searchSessionSongs: searchSongs,
  browseSessionSongs: browseSongs,
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

vi.mock("@/components/public/use-public-queue-realtime", () => ({
  usePublicQueueRealtime: (
    _token: string | null,
    onInvalidate: NonNullable<typeof realtime.onInvalidate>,
  ) => {
    realtime.onInvalidate = onInvalidate;
    return "disconnected";
  },
}));

vi.mock("next/navigation", () => {
  const router = { back: routerBack, push: routerPush, refresh: refreshRouter };

  return {
    useRouter: () => router,
    usePathname: () => navigationState.pathname,
    useSearchParams: () => navigationState.searchParams,
  };
});

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const event = {
  name: "Test Event",
  venue: "Test Venue",
  startsAt: "2026-07-18T18:00:00.000Z",
  status: "active" as const,
  publicQueueEnabled: false,
  songRequestsEnabled: true,
  publicShowSongTitles: false,
  autoCloseAt: "2026-07-18T23:00:00.000Z",
  endsAt: "2026-07-18T23:00:00.000Z",
  closedAt: null,
};

const song = {
  id: 11,
  source: "ising" as const,
  title: "Test Song",
  artist: "Test Artist",
  durationSeconds: null,
  isDuet: false,
  isExplicit: false,
  isPlus: false,
  isHit: false,
};

describe("session request feedback", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    createRequest.mockReset();
    getParticipantRequests.mockReset();
    cancelParticipantRequest.mockReset();
    renameParticipant.mockReset();
    getEvent.mockReset();
    getQueue.mockReset();
    realtime.onInvalidate = null;
    refreshRouter.mockReset();
    routerBack.mockReset();
    routerPush.mockReset();
    navigationState.pathname = "/s/AbCdEfGhIjKlMnOpQrStUv";
    navigationState.searchParams = new URLSearchParams();
    searchSongs.mockReset();
    browseSongs.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    getQueue.mockResolvedValue({
      enabled: true,
      showSongTitles: true,
      items: [],
    });
    searchSongs.mockResolvedValue([song]);
    browseSongs.mockResolvedValue({ items: [song], nextCursor: null });
    getParticipantRequests.mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("requires selecting a result before exposing the add-to-queue action", () => {
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);

    expect(screen.queryByRole("button", { name: "Dodaj do kolejki" })).not.toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(createRequest).not.toHaveBeenCalled();
  });

  it("shows discovery for an empty query and restores it after clearing search without refetching it", async () => {
    render(
      <SessionRequestPage
        discovery={{
          genres: [{ value: "pop", label: "Pop", count: 120 }],
          languages: [],
          features: { duetCount: 1, hitCount: 1, plusCount: 0 },
        }}
        event={event}
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
      />,
    );

    expect(await screen.findByRole("heading", { name: "Gatunki" })).toBeVisible();
    await waitFor(() => expect(browseSongs).toHaveBeenCalledTimes(3));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Test" } });
    fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
    expect(await screen.findByRole("heading", { name: "„Test”" })).toBeVisible();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(await screen.findByRole("heading", { name: "Gatunki" })).toBeVisible();
    expect(browseSongs).toHaveBeenCalledTimes(3);
  });

  it("keeps Discovery data while queue and profile state change", async () => {
    render(
      <SessionRequestPage
        discovery={{
          genres: [{ value: "pop", label: "Pop", count: 120 }],
          languages: [],
          features: { duetCount: 1, hitCount: 1, plusCount: 0 },
        }}
        event={{ ...event, publicQueueEnabled: true }}
        participantDisplayName="Ala"
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
      />,
    );

    await waitFor(() => expect(browseSongs).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    browseSongs.mockClear();
    getQueue.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Zmień swój nick" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Zmień swój nick" })).getByRole(
        "button",
        { name: "Anuluj" },
      ),
    );
    const queueHeaderTrigger = screen.getAllByRole("button", {
      name: "Otwórz kolejkę",
    })[0]!;
    fireEvent.click(queueHeaderTrigger);
    fireEvent.click(await screen.findByRole("button", { name: "Zwiń kolejkę" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Kolejka" })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Otwórz kolejkę" })[1]).toHaveFocus(),
    );
    expect(screen.getByRole("heading", { name: "Gatunki" })).toBeVisible();
    expect(getQueue).not.toHaveBeenCalled();

    await act(async () => {
      await realtime.onInvalidate?.("queue", new AbortController().signal);
    });

    expect(browseSongs).not.toHaveBeenCalled();
  });

  it("preserves submitted search results and avoids search or queue refetches while the queue opens", async () => {
    render(
      <SessionRequestPage
        event={{ ...event, publicQueueEnabled: true }}
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
      />,
    );

    const searchbox = screen.getByRole("searchbox");
    fireEvent.change(searchbox, { target: { value: "Test" } });
    fireEvent.submit(searchbox.closest("form")!);
    expect(await screen.findByRole("heading", { name: "„Test”" })).toBeVisible();
    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    searchSongs.mockClear();
    getQueue.mockClear();

    fireEvent.click(screen.getAllByRole("button", { name: "Otwórz kolejkę" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Zwiń kolejkę" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Kolejka" })).not.toBeInTheDocument(),
    );

    expect(searchbox).toHaveValue("Test");
    expect(screen.getByRole("heading", { name: "„Test”" })).toBeVisible();
    expect(searchSongs).not.toHaveBeenCalled();
    expect(getQueue).not.toHaveBeenCalled();
  });

  it("does not refetch Discovery after submitting a song selected from it", async () => {
    createRequest.mockResolvedValue({});
    render(
      <SessionRequestPage
        discovery={{
          genres: [],
          languages: [],
          features: { duetCount: 0, hitCount: 1, plusCount: 0 },
        }}
        event={event}
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
      />,
    );

    await waitFor(() => expect(browseSongs).toHaveBeenCalledTimes(2));
    browseSongs.mockClear();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Test Song — Test Artist" })[0]!,
    );
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Test Song" })).getByRole(
        "button",
        { name: "Dodaj do kolejki" },
      ),
    );

    await waitFor(() => expect(createRequest).toHaveBeenCalledOnce());
    expect(browseSongs).not.toHaveBeenCalled();
  });

  it("opens song details from a result and renders only available metadata", async () => {
    searchSongs.mockResolvedValueOnce([{ ...song, durationSeconds: 215 }]);
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);

    await openSongDetails();

    const drawer = await screen.findByRole("dialog", { name: "Test Song" });
    expect(within(drawer).getByText("iSing")).toBeVisible();
    expect(within(drawer).getByText("3:35")).toBeVisible();
    expect(within(drawer).queryByText(/rok|tonacja|wersja/i)).not.toBeInTheDocument();
  });

  it("renders an accessible fallback artwork and truncation-safe long result title", async () => {
    const longTitle =
      "Thank You for the Music (Live at Wembley Arena, London, 1979)";
    searchSongs.mockResolvedValueOnce([{ ...song, title: longTitle }]);
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Music" } });
    fireEvent.submit(screen.getByRole("searchbox").closest("form")!);

    const result = (await screen.findByText(longTitle)).closest("button");
    if (!result) throw new Error("Expected the long title to remain in its result button.");
    expect(result).toHaveAttribute("type", "button");
    expect(result.querySelector("svg")).not.toBeNull();
  });

  it("renders search loading before a pending result response resolves", async () => {
    const search = deferred<typeof song[]>();
    searchSongs.mockReturnValueOnce(search.promise);
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Test" } });
    fireEvent.submit(screen.getByRole("searchbox").closest("form")!);

    expect(await screen.findByLabelText("Wczytywanie wyników")).toBeVisible();
    search.resolve([song]);
    expect(await screen.findByRole("button", { name: /Test Song/ })).toBeVisible();
  });

  it("waits 250 ms before searching and never queries a one-character term", async () => {
    vi.useFakeTimers();
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);

    const searchbox = screen.getByRole("searchbox");
    fireEvent.change(searchbox, { target: { value: "A" } });
    expect(screen.getByText("Wpisz co najmniej 2 znaki.")).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(searchSongs).not.toHaveBeenCalled();

    fireEvent.change(searchbox, { target: { value: "AB" } });
    expect(searchbox).not.toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(searchSongs).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(searchSongs).toHaveBeenCalledWith(
      "AbCdEfGhIjKlMnOpQrStUv",
      "AB",
      expect.any(AbortSignal),
    );
  });

  it("submits a valid live-search term immediately on Enter without leaving the debounce queued", async () => {
    vi.useFakeTimers();
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);

    const searchbox = screen.getByRole("searchbox");
    fireEvent.change(searchbox, { target: { value: "AB" } });
    fireEvent.submit(searchbox.closest("form")!);

    await act(async () => {});
    expect(searchSongs).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(searchSongs).toHaveBeenCalledOnce();
  });

  it("restores the catalog scroll position after clearing live search", async () => {
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 184,
    });
    render(
      <SessionRequestPage
        discovery={{
          genres: [{ value: "rock", label: "Rock", count: 120 }],
          languages: [],
          features: { duetCount: 0, hitCount: 0, plusCount: 0 },
        }}
        event={event}
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
      />,
    );
    const main = screen.getByRole("main") as HTMLElement;
    const mainScrollTo = vi.fn();
    main.scrollTop = 96;
    Object.assign(main, { scrollTo: mainScrollTo });

    const searchbox = screen.getByRole("searchbox");
    fireEvent.change(searchbox, { target: { value: "Test" } });
    fireEvent.change(searchbox, { target: { value: "" } });

    await waitFor(() => expect(mainScrollTo).toHaveBeenCalledWith({ top: 96 }));
    expect(window.scrollTo).toHaveBeenCalledWith(0, 184);
  });

  it("uses the genre fallback when the catalog route was opened directly", async () => {
    navigationState.pathname = "/s/AbCdEfGhIjKlMnOpQrStUv/catalog";
    navigationState.searchParams = new URLSearchParams("genre=rock");
    render(
      <SessionRequestPage
        discovery={{
          genres: [{ value: "rock", label: "Rock", count: 120 }],
          languages: [],
          features: { duetCount: 0, hitCount: 0, plusCount: 0 },
        }}
        event={event}
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Wróć do gatunków" }));
    expect(routerPush).toHaveBeenCalledWith("/s/AbCdEfGhIjKlMnOpQrStUv/catalog/genres");
    expect(routerBack).not.toHaveBeenCalled();
  });

  it("uses browser Back after an in-session catalog navigation", async () => {
    const { rerender } = render(
      <SessionRequestPage
        discovery={{
          genres: [{ value: "rock", label: "Rock", count: 120 }],
          languages: [],
          features: { duetCount: 0, hitCount: 0, plusCount: 0 },
        }}
        event={event}
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
      />,
    );
    navigationState.pathname = "/s/AbCdEfGhIjKlMnOpQrStUv/catalog/genres";
    rerender(
      <SessionRequestPage
        discovery={{
          genres: [{ value: "rock", label: "Rock", count: 120 }],
          languages: [],
          features: { duetCount: 0, hitCount: 0, plusCount: 0 },
        }}
        event={event}
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
      />,
    );
    await screen.findByRole("heading", { name: "Gatunki" });

    fireEvent.click(screen.getByRole("button", { name: "Wróć do odkrywania" }));
    expect(routerBack).toHaveBeenCalledOnce();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("aborts an obsolete live search and ignores its late response", async () => {
    vi.useFakeTimers();
    const first = deferred<Array<typeof song>>();
    const second = deferred<Array<typeof song>>();
    searchSongs
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);

    const searchbox = screen.getByRole("searchbox");
    fireEvent.change(searchbox, { target: { value: "AB" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    const firstSignal = searchSongs.mock.calls[0]?.[2] as AbortSignal;

    fireEvent.change(searchbox, { target: { value: "ABC" } });
    expect(firstSignal.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      first.resolve([{ ...song, title: "Obsolete Song" }]);
      second.resolve([{ ...song, title: "Newest Song" }]);
      await Promise.all([first.promise, second.promise]);
    });
    expect(screen.getByText("Newest Song")).toBeVisible();
    expect(screen.queryByText("Obsolete Song")).not.toBeInTheDocument();
  });

  it("renders a calm no-results state", async () => {
    searchSongs.mockResolvedValueOnce([]);
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "xyz" } });
    fireEvent.submit(screen.getByRole("searchbox").closest("form")!);

    expect(await screen.findByText("Nie znaleziono pasujących piosenek.")).toBeVisible();
  });

  it("disables the drawer CTA while a request is being submitted", async () => {
    const request = deferred<{}>();
    createRequest.mockReturnValueOnce(request.promise);
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);

    await openSongDetails();
    const drawer = await screen.findByRole("dialog", { name: "Test Song" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Dodaj do kolejki" }));

    expect(await within(drawer).findByRole("button", { name: "Dodaję…" })).toBeDisabled();
    expect(createRequest).toHaveBeenCalledOnce();
    request.resolve({});
  });

  it("blocks a double submit while the first request is pending", async () => {
    const request = deferred<{}>();
    createRequest.mockReturnValueOnce(request.promise);
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);

    await openSongDetails();
    const submit = within(
      await screen.findByRole("dialog", { name: "Test Song" }),
    ).getByRole("button", { name: "Dodaj do kolejki" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(createRequest).toHaveBeenCalledOnce();
    request.resolve({});
  });

  it("closes song details by its close action and Escape", async () => {
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);
    await openSongDetails();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij szczegóły utworu" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Test Song" })).toBeNull());

    await openSongDetails();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Test Song" })).toBeNull());
  });

  it("opens and closes the participant nickname drawer without a mutation", async () => {
    render(
      <SessionRequestPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        event={event}
        participantDisplayName="Ala"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Zmień swój nick" }));
    const drawer = screen.getByRole("dialog", { name: "Zmień swój nick" });
    expect(drawer).toBeVisible();
    fireEvent.click(within(drawer).getByRole("button", { name: "Anuluj" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(renameParticipant).not.toHaveBeenCalled();
  });

  it("renders the queue view and its empty state", async () => {
    render(
      <SessionRequestPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        event={{ ...event, publicQueueEnabled: true }}
        participantDisplayName="Ala"
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Otwórz kolejkę" })[0]!);
    expect(screen.getAllByRole("heading", { name: "Kolejka" })).toHaveLength(2);
    expect(await screen.findAllByText("0 utworów w kolejce")).toHaveLength(2);
    expect(
      screen.getAllByText("Kolejka nie ma jeszcze publicznie widocznych zgłoszeń."),
    ).toHaveLength(2);
  });

  it("shows a success toast and refreshes the server-backed request list", async () => {
    createRequest.mockResolvedValue({});
    getParticipantRequests
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValue({
        items: [
          {
            id: "c09f9509-0677-45cc-98b2-b6f3892035de",
            title: "Test Song",
            artist: "Test Artist",
            status: "pending",
            queuePosition: null,
            isNext: false,
            createdAt: "2026-07-18T18:00:00.000Z",
          },
        ],
      });
    render(
      <SessionRequestPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        event={event}
        participantDisplayName="Ala"
      />,
    );
    await completeRequestForm();

    await waitFor(() => expect(createRequest).toHaveBeenCalledOnce());
    expect(toastSuccess).toHaveBeenCalledWith("Dodano zgłoszenie", {
      description: "Operator musi je zatwierdzić.",
    });
    fireEvent.click(await screen.findByRole("tab", { name: "Moje 1" }));
    expect(await screen.findByText("Moje zgłoszenia")).toBeVisible();
    expect(await screen.findByText("Test Song")).toBeVisible();
    expect(screen.queryByText("Twoje ostatnie zgłoszenie")).not.toBeInTheDocument();
    expect(getParticipantRequests).toHaveBeenCalledTimes(2);
    expect(createRequest).toHaveBeenCalledWith("AbCdEfGhIjKlMnOpQrStUv", {
      songId: 11,
    });
  });

  it("shows a persistent duplicate alert without duplicating it in Sonner", async () => {
    const { SessionClientError } = await import(
      "@/components/public/session-api"
    );
    createRequest.mockRejectedValue(
      new SessionClientError(
        409,
        "SESSION_REQUEST_DUPLICATE",
        "safe duplicate",
      ),
    );
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);
    await completeRequestForm();

    expect(
      await screen.findByText("To zgłoszenie już czeka"),
    ).toBeVisible();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("renames the participant and cancels only a pending owned request", async () => {
    const item = {
      id: "c09f9509-0677-45cc-98b2-b6f3892035de",
      title: "Test Song",
      artist: "Test Artist",
      status: "pending" as const,
      queuePosition: null,
      isNext: false,
      createdAt: "2026-07-18T18:00:00.000Z",
    };
    getParticipantRequests.mockResolvedValue({ items: [item] });
    renameParticipant.mockResolvedValue({ participant: { displayName: "Nowa Ala" } });
    cancelParticipantRequest.mockResolvedValue({ request: { id: item.id, status: "skipped" } });
    render(
      <SessionRequestPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        event={event}
        participantDisplayName="Ala"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Zmień swój nick" }));
    expect(screen.getByRole("dialog", { name: "Zmień swój nick" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Twój nick"), {
      target: { value: "Nowa Ala" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(renameParticipant).toHaveBeenCalledWith(
        "AbCdEfGhIjKlMnOpQrStUv",
        "Nowa Ala",
      ),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Nazwa została zmieniona");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Zmień swój nick" })).toBeNull(),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Moje 1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Anuluj" }));
    getParticipantRequests.mockResolvedValue({
      items: [{ ...item, status: "skipped" }],
    });
    fireEvent.click(await screen.findByRole("button", { name: "Anuluj zgłoszenie" }));
    await waitFor(() =>
      expect(cancelParticipantRequest).toHaveBeenCalledWith(
        "AbCdEfGhIjKlMnOpQrStUv",
        item.id,
      ),
    );
    expect(await screen.findByText("Pominięte")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Anuluj" })).not.toBeInTheDocument();
  });

  it.each([
    ["one ASCII character", "A", null],
    ["two ASCII characters", "AB", "AB"],
    ["24 ASCII characters", "A".repeat(24), "A".repeat(24)],
    ["25 ASCII characters", "A".repeat(25), null],
    ["24 emoji", "🎤".repeat(24), "🎤".repeat(24)],
    ["25 emoji", "🎤".repeat(25), null],
    ["one emoji", "🎤", null],
    ["decomposed Unicode and whitespace", "  Żo\u0301łć\t  A  ", "Żółć A"],
  ] as const)(
    "uses backend-compatible Unicode rename validation for %s",
    async (_label, value, expectedDisplayName) => {
      renameParticipant.mockResolvedValue({
        participant: { displayName: expectedDisplayName ?? "unchanged" },
      });
      render(
        <SessionRequestPage
          sessionToken="AbCdEfGhIjKlMnOpQrStUv"
          event={event}
          participantDisplayName="Ala"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Zmień swój nick" }));
      const input = screen.getByLabelText("Twój nick");

      expect(input).not.toHaveAttribute("minlength");
      expect(input).not.toHaveAttribute("maxlength");
      fireEvent.change(input, { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

      if (expectedDisplayName === null) {
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Nazwa musi mieć od 2 do 24 znaków.",
        );
        expect(renameParticipant).not.toHaveBeenCalled();
        return;
      }

      await waitFor(() =>
        expect(renameParticipant).toHaveBeenCalledWith(
          "AbCdEfGhIjKlMnOpQrStUv",
          expectedDisplayName,
        ),
      );
    },
  );

  it("keeps one cancel dialog pending and blocks every other cancel trigger", async () => {
    const first = {
      id: "c09f9509-0677-45cc-98b2-b6f3892035de",
      title: "First Song",
      artist: "Test Artist",
      status: "pending" as const,
      queuePosition: null,
      isNext: false,
      createdAt: "2026-07-18T18:00:00.000Z",
    };
    const second = {
      ...first,
      id: "d09f9509-0677-45cc-98b2-b6f3892035de",
      title: "Second Song",
    };
    const cancellation = deferred<{
      request: { id: string; status: "skipped" };
    }>();
    getParticipantRequests.mockResolvedValue({ items: [first, second] });
    cancelParticipantRequest.mockImplementation(() => {
      getParticipantRequests.mockResolvedValue({
        items: [{ ...first, status: "skipped" as const }, second],
      });
      return cancellation.promise;
    });
    render(
      <SessionRequestPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        event={event}
        participantDisplayName="Ala"
      />,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Moje 2" }));
    const firstRequest = await screen.findByText("First Song");
    const firstArticle = firstRequest.closest("article")!;
    const secondRequest = await screen.findByText("Second Song");
    const secondArticle = secondRequest.closest("article")!;
    const firstCancelTrigger = within(firstArticle).getByRole("button", {
      name: "Anuluj",
    });
    const secondCancelTrigger = within(secondArticle).getByRole("button", {
      name: "Anuluj",
    });
    fireEvent.click(firstCancelTrigger);
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Anuluj zgłoszenie",
      }),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("button", { name: "Anuluję…" }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Wróć" })).toBeDisabled();
    expect(firstCancelTrigger).toBeDisabled();
    expect(secondCancelTrigger).toBeDisabled();
    fireEvent.click(firstCancelTrigger);
    fireEvent.click(secondCancelTrigger);
    expect(cancelParticipantRequest).toHaveBeenCalledOnce();

    await act(async () => {
      cancellation.resolve({
        request: { id: first.id, status: "skipped" },
      });
      await cancellation.promise;
    });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(cancelParticipantRequest).toHaveBeenCalledOnce();
    expect(await screen.findByText("Pominięte")).toBeVisible();
    expect(getParticipantRequests).toHaveBeenCalledTimes(2);
  });

  it("uses a queue-only broadcast to refresh queue data without fetching event state", async () => {
    render(
      <SessionRequestPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        event={{ ...event, publicQueueEnabled: true }}
        participantDisplayName="Ala"
      />,
    );
    await waitFor(() => expect(getParticipantRequests).toHaveBeenCalledOnce());
    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    getParticipantRequests.mockClear();
    getQueue.mockClear();
    getParticipantRequests.mockResolvedValue({
      items: [
        {
          id: "c09f9509-0677-45cc-98b2-b6f3892035de",
          title: "New request",
          artist: "Test Artist",
          status: "pending",
          queuePosition: null,
          isNext: false,
          createdAt: "2026-07-18T18:00:00.000Z",
        },
      ],
    });
    getQueue.mockResolvedValue({
      enabled: true,
      showSongTitles: true,
      items: [
        {
          id: 99,
          singerName: "Zenek",
          status: "approved",
          position: 1,
          createdAt: "2026-07-18T18:00:00.000Z",
          title: "Queue song",
          artist: "Queue artist",
        },
      ],
    });

    await act(async () => {
      await realtime.onInvalidate?.("queue", new AbortController().signal);
    });

    expect(getParticipantRequests).toHaveBeenCalledOnce();
    expect(getQueue).toHaveBeenCalledOnce();
    expect(getEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Moje 1" }));
    expect(await screen.findByText("New request")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Kolejka" }));
    expect(await screen.findByText("Queue song")).toBeVisible();
    expect(screen.getByText("Queue artist")).toBeVisible();
  });

  it("uses one queue refresh for an own create and its following broadcast", async () => {
    createRequest.mockResolvedValue({ request: { id: "created", status: "pending" } });
    render(
      <SessionRequestPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        event={{ ...event, publicQueueEnabled: true }}
        participantDisplayName="Ala"
      />,
    );
    await waitFor(() => expect(getParticipantRequests).toHaveBeenCalledOnce());
    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    getParticipantRequests.mockClear();
    getQueue.mockClear();

    await completeRequestForm();
    await waitFor(() => expect(createRequest).toHaveBeenCalledOnce());
    await act(async () => {
      await realtime.onInvalidate?.("queue", new AbortController().signal);
    });

    expect(getParticipantRequests).toHaveBeenCalledOnce();
    expect(getQueue).toHaveBeenCalledOnce();
    expect(getEvent).not.toHaveBeenCalled();
  });

  it("uses one queue refresh for an own cancel and its following broadcast", async () => {
    const item = {
      id: "c09f9509-0677-45cc-98b2-b6f3892035de",
      title: "Test Song",
      artist: "Test Artist",
      status: "pending" as const,
      queuePosition: null,
      isNext: false,
      createdAt: "2026-07-18T18:00:00.000Z",
    };
    getParticipantRequests.mockResolvedValue({ items: [item] });
    cancelParticipantRequest.mockResolvedValue({
      request: { id: item.id, status: "skipped" },
    });
    render(
      <SessionRequestPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        event={{ ...event, publicQueueEnabled: true }}
        participantDisplayName="Ala"
      />,
    );
    await waitFor(() => expect(getParticipantRequests).toHaveBeenCalledOnce());
    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    getParticipantRequests.mockClear();
    getQueue.mockClear();

    fireEvent.click(screen.getByRole("tab", { name: "Moje 1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Anuluj" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Anuluj zgłoszenie",
      }),
    );
    await waitFor(() => expect(cancelParticipantRequest).toHaveBeenCalledOnce());
    await act(async () => {
      await realtime.onInvalidate?.("queue", new AbortController().signal);
    });

    expect(getParticipantRequests).toHaveBeenCalledOnce();
    expect(getQueue).toHaveBeenCalledOnce();
    expect(getEvent).not.toHaveBeenCalled();
  });

  it("performs a full authoritative refresh after reconnect", async () => {
    getEvent.mockResolvedValue({ accessStatus: "active", event: { ...event, publicQueueEnabled: true } });
    render(
      <SessionRequestPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        event={{ ...event, publicQueueEnabled: true }}
        participantDisplayName="Ala"
      />,
    );
    await waitFor(() => expect(getParticipantRequests).toHaveBeenCalledOnce());
    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    getParticipantRequests.mockClear();
    getQueue.mockClear();

    await act(async () => {
      await realtime.onInvalidate?.("reconnect", new AbortController().signal);
    });

    expect(getEvent).toHaveBeenCalledOnce();
    expect(getParticipantRequests).toHaveBeenCalledOnce();
    expect(getQueue).toHaveBeenCalledOnce();
  });

  it("shows rate limiting as a persistent alert", async () => {
    const { SessionClientError } = await import(
      "@/components/public/session-api"
    );
    createRequest.mockRejectedValue(
      new SessionClientError(429, "SESSION_RATE_LIMITED", "safe rate limit"),
    );
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);
    await completeRequestForm();

    expect(await screen.findByText("Zbyt wiele prób")).toBeVisible();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows a transient error toast for a non-persistent write failure", async () => {
    createRequest.mockRejectedValue(new Error("network"));
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);
    await completeRequestForm();

    await waitFor(() => expect(createRequest).toHaveBeenCalledOnce());
    expect(toastError).toHaveBeenCalledWith(
      "Nie udało się dodać zgłoszenia",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });
  it("refreshes the page for a capability invalidation without fetching stale queue data", async () => {
    render(
      <SessionRequestPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        event={{ ...event, publicQueueEnabled: true }}
      />,
    );

    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    getQueue.mockClear();

    await act(async () => {
      await realtime.onInvalidate?.(
        "capabilities",
        new AbortController().signal,
      );
    });

    expect(refreshRouter).toHaveBeenCalledOnce();
    expect(getEvent).not.toHaveBeenCalled();
    expect(getQueue).not.toHaveBeenCalled();
  });
});

async function completeRequestForm() {
  await openSongDetails();
  fireEvent.click(
    within(await screen.findByRole("dialog", { name: "Test Song" })).getByRole(
      "button",
      { name: "Dodaj do kolejki" },
    ),
  );
}

async function openSongDetails() {
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Test" },
  });
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  fireEvent.click(await screen.findByRole("button", { name: /Test Song/ }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
