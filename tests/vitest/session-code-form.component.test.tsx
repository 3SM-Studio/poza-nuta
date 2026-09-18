// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionCodeForm } from "@/components/public/session-code-form";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("SessionCodeForm", () => {
  beforeEach(() => {
    push.mockReset();
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => null,
    });
  });

  it("accepts keyboard entry of exactly six digits and preserves leading zeros", () => {
    render(<SessionCodeForm />);
    const input = screen.getByLabelText("Sześciocyfrowy kod sesji");
    const submit = screen.getByRole("button", { name: "Dołącz" });

    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("maxlength", "6");
    expect(document.querySelectorAll('[data-slot="input-otp-slot"]')).toHaveLength(6);
    expect(submit).toBeDisabled();

    typeDigits(input, "004271");

    expect(input).toHaveValue("004271");
    expect(submit).toBeEnabled();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(submit);
    expect(push).toHaveBeenCalledWith("/join/004271");
  });

  it("captures a six-digit paste before input-otp and preserves leading zeros", () => {
    render(<SessionCodeForm />);
    const input = screen.getByLabelText("Sześciocyfrowy kod sesji");
    const submit = screen.getByRole("button", { name: "Dołącz" });

    fireEvent.change(input, { target: { value: "12ab" } });
    expect(input).toHaveValue("");

    dispatchClipboardPaste(input, "00 4271");
    expect(input).toHaveValue("");

    dispatchClipboardPaste(input, " 004271 ");
    expect(input).toHaveValue("004271");
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(push).toHaveBeenCalledWith("/join/004271");
  });

  it.each([
    "12345",
    "1234567",
    "12345678",
    "123456789",
    "abcdef",
    "١٢٣٤٥٦",
    "１２３４５６",
    "12345６",
    "12-3456",
  ])(
    "does not truncate invalid pasted %s into a valid code",
    (invalidCode) => {
      render(<SessionCodeForm />);
      const input = screen.getByLabelText("Sześciocyfrowy kod sesji");
      const submit = screen.getByRole("button", { name: "Dołącz" });

      dispatchClipboardPaste(input, invalidCode);

      expect(input).toHaveValue("");
      expect(input).not.toHaveValue("123456");
      expect(submit).toBeDisabled();
      expect(push).not.toHaveBeenCalled();
    },
  );

  it("clears a previous valid code when an invalid paste is captured", () => {
    render(<SessionCodeForm />);
    const input = screen.getByLabelText("Sześciocyfrowy kod sesji");
    const submit = screen.getByRole("button", { name: "Dołącz" });

    dispatchClipboardPaste(input, "004271");
    expect(submit).toBeEnabled();
    dispatchClipboardPaste(input, "12345678");

    expect(input).toHaveValue("");
    expect(submit).toBeDisabled();
    expect(push).not.toHaveBeenCalled();
  });

  it("submits with Enter only when all six slots are complete", () => {
    render(<SessionCodeForm />);
    const input = screen.getByLabelText("Sześciocyfrowy kod sesji");

    typeDigits(input, "1234");
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(screen.getByText("Wpisz dokładnie 6 cyfr kodu sesji.")).toBeVisible();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(push).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "123456" } });
    expect(input).toHaveAttribute("aria-invalid", "false");
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(push).toHaveBeenCalledWith("/join/123456");
  });

  it("shows a processing state and prevents duplicate submit during the join transition", async () => {
    let resolveTransition: (() => void) | undefined;
    const onSubmitCode = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTransition = resolve;
        }),
    );
    render(<SessionCodeForm onSubmitCode={onSubmitCode} />);
    const input = screen.getByLabelText("Sześciocyfrowy kod sesji");
    const submit = screen.getByRole("button", { name: "Dołącz" });

    dispatchClipboardPaste(input, "004271");
    fireEvent.click(submit);

    expect(onSubmitCode).toHaveBeenCalledWith("004271");
    expect(screen.getByRole("button", { name: "Łączymy…" })).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    expect(onSubmitCode).toHaveBeenCalledOnce();

    act(() => resolveTransition?.());
    await waitFor(() => expect(screen.getByRole("button", { name: "Dołącz" })).toBeEnabled());
  });
});

function typeDigits(input: HTMLElement, digits: string) {
  let value = "";
  for (const digit of digits) {
    value += digit;
    fireEvent.keyDown(input, { key: digit, code: `Digit${digit}` });
    fireEvent.input(input, {
      target: { value },
      data: digit,
      inputType: "insertText",
    });
    fireEvent.keyUp(input, { key: digit, code: `Digit${digit}` });
  }
}

function dispatchClipboardPaste(input: HTMLElement, text: string) {
  const targetPasteHandler = vi.fn();
  input.addEventListener("paste", targetPasteHandler);

  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : "") },
  });

  let dispatched = true;
  act(() => {
    dispatched = input.dispatchEvent(event);
  });
  input.removeEventListener("paste", targetPasteHandler);

  expect(dispatched).toBe(false);
  expect(event.defaultPrevented).toBe(true);
  expect(targetPasteHandler).not.toHaveBeenCalled();
}
