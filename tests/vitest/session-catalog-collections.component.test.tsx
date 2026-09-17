// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionCatalogCollections } from "@/components/public/session-catalog-collections";

const { getCollections } = vi.hoisted(() => ({ getCollections: vi.fn() }));

vi.mock("@/components/public/session-api", () => ({
  getSessionCatalogCollections: getCollections,
}));

describe("SessionCatalogCollections", () => {
  beforeEach(() => getCollections.mockReset());

  it("lists the global section and links cards to the shared playlist route", async () => {
    getCollections.mockResolvedValue({
      items: [
        {
          filterKey: "pl_test-classics",
          type: "playlist",
          section: "playlist",
          title: "Testowe klasyki",
          description: "Fixture",
          coverImage: null,
        },
      ],
    });

    render(
      <SessionCatalogCollections
        onBack={vi.fn()}
        section="playlist"
        sessionToken="AbCdEfGhIjKlMnOpQrStUv"
      />,
    );

    const link = await screen.findByRole("link", {
      name: "Otwórz kolekcję Testowe klasyki",
    });
    expect(getCollections).toHaveBeenCalledWith(
      "AbCdEfGhIjKlMnOpQrStUv",
      "playlist",
      expect.any(AbortSignal),
    );
    expect(link).toHaveAttribute(
      "href",
      "/s/AbCdEfGhIjKlMnOpQrStUv/playlist?filter=pl_test-classics",
    );
  });

  it("covers empty and retryable error states", async () => {
    getCollections.mockResolvedValueOnce({ items: [] });
    const { rerender } = render(
      <SessionCatalogCollections
        onBack={vi.fn()}
        section="style"
        sessionToken="token"
      />,
    );
    expect(
      await screen.findByText("Nie ma teraz aktywnych kolekcji stylów."),
    ).toBeVisible();

    getCollections.mockRejectedValueOnce(new Error("offline"));
    rerender(
      <SessionCatalogCollections
        onBack={vi.fn()}
        section="style"
        sessionToken="another-token"
      />,
    );
    expect(
      await screen.findByText("Nie udało się wczytać kolekcji. Spróbuj ponownie."),
    ).toBeVisible();
  });
});
