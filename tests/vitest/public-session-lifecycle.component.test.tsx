// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PublicSessionLifecycle } from "@/components/public/public-session-lifecycle";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("PublicSessionLifecycle", () => {
  it("presents a scheduled event as an intentional destination with event context", () => {
    render(<PublicSessionLifecycle event={{ name: "Noc Mikrofonów", venue: "Klub Fala", startsAt: "2026-09-20T18:00:00.000Z" }} kind="scheduled" />);
    expect(screen.getByRole("heading", { level: 1, name: "Noc Mikrofonów" })).toBeVisible();
    expect(screen.getByText("Jesteś we właściwym miejscu")).toBeVisible();
    expect(screen.getByText("Klub Fala")).toBeVisible();
    expect(screen.getByRole("button", { name: /Spróbuj ponownie/ })).toBeVisible();
  });

  it("distinguishes cancellation from a normally ended event", () => {
    const { rerender } = render(<PublicSessionLifecycle kind="cancelled" />);
    expect(screen.getByText("Wydarzenie zostało odwołane")).toBeVisible();
    rerender(<PublicSessionLifecycle kind="closed" reopenable />);
    expect(screen.getByText("Karaoke dobiegło końca")).toBeVisible();
    expect(screen.getByText(/może jeszcze wznowić/)).toBeVisible();
  });

  it("gives an invalid link a branded route back to code entry", () => {
    render(<PublicSessionLifecycle kind="invalid" />);
    expect(screen.getByText("Ta sesja nie jest dostępna")).toBeVisible();
    expect(screen.getByRole("link", { name: "Wpisz kod wydarzenia" })).toHaveAttribute("href", "/join");
  });
});
