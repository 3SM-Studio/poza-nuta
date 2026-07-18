// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventSessionAccessPanel } from "@/components/operator/event-session-access-panel";
import { AppThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

const writeText = vi.fn();

vi.mock("qrcode", () => ({
  default: { toCanvas: vi.fn(() => Promise.resolve()) },
}));

describe("session action feedback", () => {
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("shows Sonner feedback after copying without a duplicate inline success", async () => {
    render(
      <AppThemeProvider>
        <EventSessionAccessPanel
          sessionCode="01234567"
          sessionUrl="https://example.test/session/01234567"
          isClosed={false}
        />
        <Toaster />
      </AppThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kopiuj kod" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("01234567"));
    expect(await screen.findByText("Kod skopiowany.")).toBeVisible();
    expect(screen.getAllByText("Kod skopiowany.")).toHaveLength(1);
  });
});
