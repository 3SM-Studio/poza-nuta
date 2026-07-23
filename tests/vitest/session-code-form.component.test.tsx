// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionCodeForm } from "@/components/public/session-code-form";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("SessionCodeForm", () => {
  beforeEach(() => push.mockReset());

  it("accepts eight digits, preserves a leading zero and waits for submit", () => {
    render(<SessionCodeForm />);
    const input = screen.getByLabelText("Ośmiocyfrowy kod sesji");
    const submit = screen.getByRole("button", { name: "Dołącz" });

    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: "01234567" } });

    expect(input).toHaveValue("01234567");
    expect(submit).toBeEnabled();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(submit);
    expect(push).toHaveBeenCalledWith("/join/01234567");
  });

  it("rejects letters and accepts a complete pasted code", () => {
    render(<SessionCodeForm />);
    const input = screen.getByLabelText("Ośmiocyfrowy kod sesji");

    fireEvent.change(input, { target: { value: "12ab" } });
    expect(input).toHaveValue("");

    fireEvent.paste(input, {
      clipboardData: { getData: () => "0012 3456" },
    });
    expect(input).toHaveValue("00123456");
    expect(push).not.toHaveBeenCalled();
  });

  it("submits with Enter only when complete", () => {
    render(<SessionCodeForm />);
    const input = screen.getByLabelText("Ośmiocyfrowy kod sesji");

    fireEvent.change(input, { target: { value: "1234" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(screen.getByText("Wpisz osiem cyfr kodu sesji.")).toBeVisible();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(push).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "12345678" } });
    expect(input).toHaveAttribute("aria-invalid", "false");
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(push).toHaveBeenCalledWith("/join/12345678");
  });
});
