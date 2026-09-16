// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionShellHeader } from "@/components/public/session-shell-header";

describe("SessionShellHeader", () => {
  it("keeps the existing search control inside an opaque sticky top area", () => {
    render(
      <SessionShellHeader
        isSubmitting={false}
        onOpenProfile={vi.fn()}
        onOpenQueue={vi.fn()}
        onSearch={vi.fn()}
        onSearchTermChange={vi.fn()}
        searchTerm=""
        showQueue
      />,
    );

    const header = screen.getByRole("banner");

    expect(header).toHaveClass("sticky", "top-0", "z-30", "bg-background/95");
    expect(screen.getByRole("searchbox")).toHaveAccessibleName("Tytuł lub wykonawca");
  });
});
