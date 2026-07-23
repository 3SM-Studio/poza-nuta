// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventSessionAccessPanel } from "@/components/operator/event-session-access-panel";
import { AppThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

const writeText = vi.fn();

describe("session action feedback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="M0 0h1024v1024H0z"/></svg>',
      })),
    );
  });

  it("shows Sonner feedback after copying without a duplicate inline success", async () => {
    render(
      <AppThemeProvider>
        <EventSessionAccessPanel
          sessionCode="01234567"
          sessionUrl="https://example.test/s/AbCdEfGhIjKlMnOpQrStUv"
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

  it("downloads a standalone SVG and revokes its object URL", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:session-qr");
    const revokeObjectURL = vi.fn();
    let downloadName = "";
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function captureDownload(this: HTMLAnchorElement) {
        downloadName = this.download;
      },
    );

    render(
      <AppThemeProvider>
        <EventSessionAccessPanel
          sessionCode="01234567"
          sessionUrl="https://example.test/s/AbCdEfGhIjKlMnOpQrStUv"
          isClosed={false}
        />
        <Toaster />
      </AppThemeProvider>,
    );

    const download = await screen.findByRole("button", {
      name: "Pobierz QR (SVG)",
    });
    await waitFor(() => expect(download).toBeEnabled());
    fireEvent.click(download);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob.type).toBe("image/svg+xml;charset=utf-8");
    expect(downloadName).toBe("poza-nuta-session-qr.svg");
    expect(downloadName).not.toContain("01234567");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:session-qr");
    expect(await screen.findByText("Kod QR został pobrany.")).toBeVisible();
  });

  it("shows a safe error toast when the SVG download fails", async () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => {
        throw new Error("download failed");
      }),
      revokeObjectURL: vi.fn(),
    });

    render(
      <AppThemeProvider>
        <EventSessionAccessPanel
          sessionCode="01234567"
          sessionUrl="https://example.test/s/AbCdEfGhIjKlMnOpQrStUv"
          isClosed={false}
        />
        <Toaster />
      </AppThemeProvider>,
    );

    const download = await screen.findByRole("button", {
      name: "Pobierz QR (SVG)",
    });
    await waitFor(() => expect(download).toBeEnabled());
    fireEvent.click(download);

    expect(
      await screen.findByText("Nie udało się pobrać kodu QR."),
    ).toBeVisible();
  });
});
