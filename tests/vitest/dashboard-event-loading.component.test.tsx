// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventPageSkeleton } from "@/components/operator/dashboard-skeletons";

describe("EventPageSkeleton", () => {
  it("announces event loading and keeps a stable responsive content shell", () => {
    const { container } = render(<EventPageSkeleton />);

    expect(
      screen.getByRole("status", { name: "Ładowanie wydarzenia" }),
    ).toHaveAttribute("aria-live", "polite");
    expect(container.querySelector("main")).toHaveClass(
      "min-h-[calc(100vh-4.5rem)]",
    );
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(15);
  });
});
