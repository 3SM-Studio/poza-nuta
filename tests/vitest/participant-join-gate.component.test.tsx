// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ParticipantJoinGate } from "@/components/public/participant-join-gate";

const { joinSession, refreshRouter } = vi.hoisted(() => ({
  joinSession: vi.fn(),
  refreshRouter: vi.fn(),
}));

vi.mock("@/components/public/session-api", () => ({
  joinSession,
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
  useRouter: () => ({ refresh: refreshRouter }),
}));

describe("participant nickname join gate", () => {
  beforeEach(() => {
    joinSession.mockReset();
    refreshRouter.mockReset();
  });

  it("normalizes the nickname, joins and refreshes the server gate", async () => {
    joinSession.mockResolvedValue({ participant: { displayName: "Michał Żółć" } });
    render(<ParticipantJoinGate sessionToken="AbCdEfGhIjKlMnOpQrStUv" />);

    fireEvent.change(screen.getByLabelText("Imię lub ksywka"), {
      target: { value: "  Michał   Żółć " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dołącz do wydarzenia" }));

    await waitFor(() =>
      expect(joinSession).toHaveBeenCalledWith(
        "AbCdEfGhIjKlMnOpQrStUv",
        "Michał Żółć",
      ),
    );
    expect(refreshRouter).toHaveBeenCalledOnce();
  });

  it("keeps invalid length inline and does not call the API", () => {
    render(<ParticipantJoinGate sessionToken="AbCdEfGhIjKlMnOpQrStUv" />);
    fireEvent.change(screen.getByLabelText("Imię lub ksywka"), {
      target: { value: "A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dołącz do wydarzenia" }));

    expect(screen.getByRole("alert")).toHaveTextContent("od 2 do 24 znaków");
    expect(joinSession).not.toHaveBeenCalled();
  });

  it("uses the backend code-point limit for astral Unicode characters", async () => {
    joinSession.mockResolvedValue({ participant: { displayName: "🎤".repeat(24) } });
    render(<ParticipantJoinGate sessionToken="AbCdEfGhIjKlMnOpQrStUv" />);
    const input = screen.getByLabelText("Imię lub ksywka");
    expect(input).not.toHaveAttribute("maxlength");

    fireEvent.change(input, { target: { value: "🎤".repeat(24) } });
    fireEvent.click(screen.getByRole("button", { name: "Dołącz do wydarzenia" }));

    await waitFor(() => expect(joinSession).toHaveBeenCalledOnce());
    expect(refreshRouter).toHaveBeenCalledOnce();
  });

  it("shows a case-insensitive collision as an actionable inline error", async () => {
    const { SessionClientError } = await import("@/components/public/session-api");
    joinSession.mockRejectedValue(
      new SessionClientError(409, "SESSION_NICKNAME_TAKEN", "taken"),
    );
    render(<ParticipantJoinGate sessionToken="AbCdEfGhIjKlMnOpQrStUv" />);
    fireEvent.change(screen.getByLabelText("Imię lub ksywka"), {
      target: { value: "Michał" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dołącz do wydarzenia" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "już używana w tym wydarzeniu",
    );
    expect(refreshRouter).not.toHaveBeenCalled();
  });
});
