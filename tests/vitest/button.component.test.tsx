// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders an accessible button and forwards native properties", () => {
    render(
      <Button type="submit" variant="secondary" disabled>
        Zapisz zmiany
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Zapisz zmiany" });

    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveAttribute("data-variant", "secondary");
    expect(button).toBeDisabled();
  });
});
