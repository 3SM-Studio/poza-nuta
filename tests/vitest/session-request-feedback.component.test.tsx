// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionRequestPage } from "@/components/public/session-request-page";

const {
  createRequest,
  getEvent,
  getQueue,
  realtime,
  refreshRouter,
  searchSongs,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
    createRequest: vi.fn(),
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
  createSessionRequest: createRequest,
  getSessionEvent: getEvent,
  getSessionQueue: getQueue,
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

  it("shows a success toast and a durable pending request state", async () => {
    createRequest.mockResolvedValue({});
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
    expect(screen.getByText("Twoje ostatnie zgłoszenie")).toBeVisible();
    expect(screen.getByText("Oczekujące")).toBeVisible();
    expect(screen.getByText(/Test Song/)).toBeVisible();
    expect(screen.getByText(/Zgłaszający: Ala/)).toBeVisible();
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
