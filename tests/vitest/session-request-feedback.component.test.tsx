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
            reason: "broadcast" | "subscribe" | "reconnect",
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshRouter }),
}));

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

  it("keeps field validation inline without a toast", () => {
    render(<SessionRequestPage sessionToken="AbCdEfGhIjKlMnOpQrStUv" event={event} />);

    const submit = screen.getByRole("button", { name: "Dodaj do kolejki" });
    fireEvent.submit(submit.closest("form")!);

    expect(screen.getByText("Wybierz piosenkę.")).toBeVisible();
    expect(screen.queryByLabelText("Imię lub ksywka")).not.toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(createRequest).not.toHaveBeenCalled();
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

    fireEvent.change(screen.getByLabelText("Zmień nazwę w tym wydarzeniu"), {
      target: { value: "Nowa Ala" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(renameParticipant).toHaveBeenCalledWith(
        "AbCdEfGhIjKlMnOpQrStUv",
        "Nowa Ala",
      ),
    );
    expect(await screen.findByText("Nowa Ala")).toBeVisible();

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
      const input = screen.getByLabelText("Zmień nazwę w tym wydarzeniu");

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
  });

  it("uses the public queue broadcast to refetch owned requests without polling", async () => {
    getEvent.mockResolvedValue({ accessStatus: "active", event });
    render(
      <SessionRequestPage
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
        event={event}
        participantDisplayName="Ala"
      />,
    );
    await waitFor(() => expect(getParticipantRequests).toHaveBeenCalledOnce());
    getParticipantRequests.mockClear();

    await act(async () => {
      await realtime.onInvalidate?.("broadcast", new AbortController().signal);
    });

    expect(getParticipantRequests).toHaveBeenCalled();
    expect(getQueue).not.toHaveBeenCalled();
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
  it("refreshes the page lifecycle without fetching a closed queue", async () => {
    getEvent.mockResolvedValue({
      accessStatus: "closed",
      event: { ...event, status: "closed" },
    });
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
        "broadcast",
        new AbortController().signal,
      );
    });

    expect(refreshRouter).toHaveBeenCalledOnce();
    expect(getQueue).not.toHaveBeenCalled();
  });
});

async function completeRequestForm() {
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Szukaj" }));
  fireEvent.click(await screen.findByRole("button", { name: /Test Song/ }));
  fireEvent.click(screen.getByRole("button", { name: "Dodaj do kolejki" }));
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
