// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLayoutView } from "@/components/platform-admin/admin-layout-view";
import { SidebarProvider } from "@/components/ui/sidebar";

let pathname = "/admin";
const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));

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
  useRouter: () => navigationMocks,
}));

afterEach(() => {
  pathname = "/admin";
  window.innerWidth = 1024;
  navigationMocks.replace.mockReset();
  navigationMocks.refresh.mockReset();
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
    expect(screen.getByText(roleLabel)).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Overview test",
    );

    const overviewLink = screen.getByRole("link", { name: "Overview" });
    expect(overviewLink).toHaveAttribute("href", "/admin");
    expect(overviewLink).toHaveAttribute("aria-current", "page");

    const importLink = screen.getByRole("link", { name: "Importy" });
    expect(importLink).toHaveAttribute("href", "/admin/imports");
    expect(importLink).not.toHaveAttribute("aria-current");
    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
    expect(screen.queryByText("Dziennik audytu")).not.toBeInTheDocument();
  });

  it("marks Imports as the current admin destination", () => {
    pathname = "/admin/imports";
    renderAllowed("platform_admin");

    expect(screen.getByRole("link", { name: "Importy" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(
      screen.getByText("Importy", {
        selector: "[data-slot='breadcrumb-page']",
      }),
    ).toBeVisible();
  });

  it("links the shared user menu to the global account", async () => {
    renderAllowed("platform_owner");
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Menu użytkownika: Anna Kowalska" }),
      { button: 0, ctrlKey: false, pointerType: "mouse" },
    );

    expect(await screen.findByRole("menuitem", { name: "Konto" })).toHaveAttribute(
      "href",
      "/account",
    );
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
    window.innerWidth = 390;
    renderAllowed("support");
    const trigger = screen.getByRole("button", {
      name: "Otwórz menu",
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
    window.innerWidth = 390;
    renderAllowed("platform_admin");
    fireEvent.click(
      screen.getByRole("button", { name: "Otwórz menu" }),
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
    <SidebarProvider
      data-management-theme="true"
      className="bg-sidebar text-foreground"
    >
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
      </AdminLayoutView>
    </SidebarProvider>,
  );
}
