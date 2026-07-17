// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLayoutView } from "@/components/platform-admin/admin-layout-view";

let pathname = "/admin";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    onClick,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
    />
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

afterEach(() => {
  pathname = "/admin";
});

describe("AdminShell", () => {
  it.each([
    ["platform_owner", "Właściciel platformy"],
    ["platform_admin", "Administrator platformy"],
    ["support", "Wsparcie"],
  ] as const)("renders a guarded shell for %s", (role, roleLabel) => {
    renderAllowed(role);

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getAllByText(roleLabel).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Overview test",
    );

    const overviewLinks = screen.getAllByRole("link", { name: "Overview" });
    expect(new Set(overviewLinks.map((link) => link.getAttribute("href")))).toEqual(
      new Set(["/admin"]),
    );
    for (const link of overviewLinks) {
      expect(link).toHaveAttribute("aria-current", "page");
    }

    const importLinks = screen.getAllByRole("link", { name: "Importy" });
    expect(new Set(importLinks.map((link) => link.getAttribute("href")))).toEqual(
      new Set(["/admin/imports"]),
    );
    for (const link of importLinks) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("marks Imports as the current admin destination", () => {
    pathname = "/admin/imports";
    renderAllowed("platform_admin");

    for (const link of screen.getAllByRole("link", { name: "Importy" })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
    for (const link of screen.getAllByRole("link", { name: "Overview" })) {
      expect(link).not.toHaveAttribute("aria-current");
    }
    expect(
      screen.getByText("Importy", {
        selector: "[data-slot='breadcrumb-page']",
      }),
    ).toBeVisible();
  });

  it("does not render the shell, actor or metrics after denial", () => {
    render(
      <AdminLayoutView access={{ kind: "denied" }}>
        <p>tajna metryka</p>
      </AdminLayoutView>,
    );

    expect(screen.getByRole("heading", { name: "Dostęp niedostępny" })).toBeVisible();
    expect(document.querySelector("[data-admin-shell]")).not.toBeInTheDocument();
    expect(screen.queryByText("Anna Kowalska")).not.toBeInTheDocument();
    expect(screen.queryByText("tajna metryka")).not.toBeInTheDocument();
  });

  it("opens the mobile Sheet, closes on Escape and restores trigger focus", async () => {
    renderAllowed("support");
    const trigger = screen.getByRole("button", {
      name: "Otwórz menu administratora",
    });

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("data-management-theme", "true");
    expect(within(dialog).getByRole("navigation")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("closes the mobile Sheet after navigating to Overview", async () => {
    renderAllowed("platform_admin");
    fireEvent.click(
      screen.getByRole("button", { name: "Otwórz menu administratora" }),
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("link", { name: "Overview" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

function renderAllowed(
  role: "platform_owner" | "platform_admin" | "support",
) {
  return render(
    <AdminLayoutView
      access={{
        kind: "allowed",
        actor: {
          displayName: "Anna Kowalska",
          initials: "AK",
          role,
        },
      }}
    >
      <h1>Overview test</h1>
    </AdminLayoutView>,
  );
}
