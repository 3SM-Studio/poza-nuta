// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JoinCodeGate } from "@/components/public/join-code-gate";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("JoinCodeGate", () => {
  beforeEach(() => {
    push.mockReset();
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => null,
    });
  });

  it("keeps one editable form visible after an invalid code and supports retry", async () => {
    const resolveCode = vi
      .fn()
      .mockResolvedValueOnce({ status: "error", error: "invalid" })
      .mockResolvedValueOnce({ status: "resolved", location: "/s/public-token" });
    render(<JoinCodeGate resolveCode={resolveCode} />);

    expect(screen.getAllByLabelText("Sześciocyfrowy kod sesji")).toHaveLength(1);
    const input = screen.getByLabelText("Sześciocyfrowy kod sesji");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Dołącz" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie znaleźliśmy aktywnego wydarzenia",
    );
    expect(input).toBeVisible();
    expect(input).toBeEnabled();
    expect(input).toHaveValue("123456");
    expect(input).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(input, { target: { value: "123455" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dołącz" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/s/public-token"));
    expect(resolveCode).toHaveBeenNthCalledWith(1, "123456", expect.any(AbortSignal));
    expect(resolveCode).toHaveBeenNthCalledWith(2, "123455", expect.any(AbortSignal));
  });

  it("keeps loading feedback on the visible form and blocks duplicate submit", async () => {
    let finish: ((value: { status: "error"; error: "unavailable" }) => void) | undefined;
    const resolveCode = vi.fn(
      () => new Promise<{ status: "error"; error: "unavailable" }>((resolve) => { finish = resolve; }),
    );
    render(<JoinCodeGate resolveCode={resolveCode} />);
    const input = screen.getByLabelText("Sześciocyfrowy kod sesji");
    fireEvent.change(input, { target: { value: "004271" } });
    const form = input.closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(resolveCode).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Łączymy…" })).toBeDisabled();
    expect(input).toBeVisible();

    finish?.({ status: "error", error: "unavailable" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie możemy teraz sprawdzić kodu",
    );
  });
});
