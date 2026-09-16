// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  searchSongs,
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
    searchSongs: vi.fn(),
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
  const router = { refresh: refreshRouter };

  return {
    useRouter: () => router,
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
    createRequest.mockReset();
    getParticipantRequests.mockReset();
    cancelParticipantRequest.mockReset();
    renameParticipant.mockReset();
    getEvent.mockReset();
    getQueue.mockReset();
    realtime.onInvalidate = null;
    refreshRouter.mockReset();
    searchSongs.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    getQueue.mockResolvedValue({
      enabled: true,
      showSongTitles: true,
      items: [],
    });
    searchSongs.mockResolvedValue([song]);
    getParticipantRequests.mockResolvedValue({ items: [] });
  });

  it("requires selecting a result before exposing the add-to-queue action", () => {
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);

    expect(screen.queryByRole("button", { name: "Dodaj do kolejki" })).not.toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(createRequest).not.toHaveBeenCalled();
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

    fireEvent.click(screen.getByRole("button", { name: "Otwórz kolejkę" }));
    expect(screen.getByRole("heading", { name: "Kolejka" })).toBeVisible();
    expect(await screen.findByText("0 utworów w kolejce")).toBeVisible();
    expect(screen.getByText("Kolejka nie ma jeszcze publicznie widocznych zgłoszeń.")).toBeVisible();
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
    expect(await screen.findByText("New request")).toBeVisible();
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
