// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionRequestPage } from "@/components/public/session-request-page";

const { createRequest, searchSongs, toastSuccess, toastError } = vi.hoisted(
  () => ({
    createRequest: vi.fn(),
    searchSongs: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  }),
);

vi.mock("@/components/public/session-api", () => ({
  createSessionRequest: createRequest,
  getSessionQueue: vi.fn(),
  searchSessionSongs: searchSongs,
  SessionClientError: class SessionClientError extends Error {
    status = 500;
    code = "REQUEST_FAILED";
  },
}));

vi.mock("@/components/public/use-public-queue-realtime", () => ({
  usePublicQueueRealtime: () => "disconnected",
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const event = {
  id: 1,
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
    searchSongs.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    searchSongs.mockResolvedValue([song]);
  });

  it("keeps field validation inline without a toast", () => {
    render(<SessionRequestPage code="01234567" event={event} />);

    const submit = screen.getByRole("button", { name: "Dodaj do kolejki" });
    fireEvent.submit(submit.closest("form")!);

    expect(screen.getByText("Wybierz piosenkę.")).toBeVisible();
    expect(screen.getAllByText(/Podaj imię lub ksywkę/)).toHaveLength(2);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(createRequest).not.toHaveBeenCalled();
  });

  it("shows a success toast after a completed request write", async () => {
    createRequest.mockResolvedValue({});
    render(<SessionRequestPage code="01234567" event={event} />);
    await completeRequestForm();

    await waitFor(() => expect(createRequest).toHaveBeenCalledOnce());
    expect(toastSuccess).toHaveBeenCalledWith("Dodano zgłoszenie", {
      description: "Operator musi je zatwierdzić.",
    });
  });

  it("shows a transient error toast for a non-persistent write failure", async () => {
    createRequest.mockRejectedValue(new Error("network"));
    render(<SessionRequestPage code="01234567" event={event} />);
    await completeRequestForm();

    await waitFor(() => expect(createRequest).toHaveBeenCalledOnce());
    expect(toastError).toHaveBeenCalledWith(
      "Nie udało się dodać zgłoszenia",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });
});

async function completeRequestForm() {
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Szukaj" }));
  fireEvent.click(await screen.findByRole("button", { name: /Test Song/ }));
  fireEvent.change(screen.getByLabelText("Imię lub ksywka"), {
    target: { value: "Ala" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Dodaj do kolejki" }));
}
