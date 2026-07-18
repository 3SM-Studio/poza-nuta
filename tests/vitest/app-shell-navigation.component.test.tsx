// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardShell } from "@/components/operator/dashboard-shell";
import { EventSidebarBridge } from "@/components/operator/event-sidebar-context";
import { SidebarProvider } from "@/components/ui/sidebar";

let pathname = "/dashboard/organizations";
const mocks = vi.hoisted(() => ({
  logout: vi.fn(async () => undefined),
  replace: vi.fn(),
  refresh: vi.fn(),
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
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("@/components/operator/api", () => ({
  logoutOperator: mocks.logout,
  OperatorClientError: class OperatorClientError extends Error {
    status: number;
    constructor(status: number) {
      super("operator error");
      this.status = status;
    }
  },
}));

afterEach(() => {
  pathname = "/dashboard/organizations";
  window.innerWidth = 1024;
  mocks.logout.mockClear();
  mocks.replace.mockClear();
  mocks.refresh.mockClear();
});

describe("shared application shell", () => {
  it("renders organizer branding, a real user, and a menu separate from admin", () => {
    renderDashboard();

    expect(screen.getByText("Poza Nutą")).toBeVisible();
    expect(screen.getAllByText("Panel organizatora").length).toBeGreaterThan(0);
    expect(screen.getByText("Jan Operator")).toBeVisible();
    expect(screen.getByText("Operator")).toBeVisible();
    expect(screen.getByRole("link", { name: "Organizacje" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Nowa organizacja" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Importy" })).toBeNull();
    expect(screen.getAllByText("Jan Operator")).toHaveLength(1);

    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toBe("#");
    }
  });

  it("renders event navigation and marks only its deepest destination active", async () => {
    pathname = "/dashboard/org/demo/events/42/queue";
    renderDashboard({ event: { eventId: "42", name: "Wieczór testowy" } });

    expect(await screen.findByText("Wieczór testowy")).toBeVisible();
    for (const label of [
      "Szczegóły",
      "Kolejka",
      "Link i QR",
      "Powrót do wydarzeń",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeVisible();
    }
    expect(
      screen
        .getAllByRole("link", { name: "Ustawienia" })
        .find(
          (link) =>
            link.getAttribute("href") ===
            "/dashboard/org/demo/events/42/settings",
        ),
    ).toBeVisible();

    const currentLinks = screen
      .getAllByRole("link")
      .filter((link) => link.hasAttribute("aria-current"));
    expect(currentLinks).toHaveLength(1);
    expect(currentLinks[0]).toHaveTextContent("Kolejka");
    expect(screen.getByRole("link", { name: "Przegląd" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(document.querySelector("[data-site-header-title='Wydarzenia']")).toBeVisible();
  });

  it("shows the admin switch only when server-side access was granted", async () => {
    const firstRender = renderDashboard({ canAccessAdmin: false });
    openUserMenu();
    expect(screen.queryByRole("menuitem", { name: "Administracja" })).toBeNull();

    firstRender.unmount();
    renderDashboard({ canAccessAdmin: true });
    openUserMenu();
    expect(
      await screen.findByRole("menuitem", { name: "Administracja" }),
    ).toBeVisible();
  });

  it("keeps the global account in the shared user menu", async () => {
    renderDashboard({ canAccessAdmin: true });
    openUserMenu();

    const accountLink = await screen.findByRole("menuitem", { name: "Konto" });
    expect(accountLink).toHaveAttribute("href", "/account");
  });

  it("renders the organization switcher in SidebarHeader and not SiteHeader", async () => {
    pathname = "/dashboard/org/demo";
    renderDashboard();

    const switcher = screen.getByRole("button", {
      name: "Wybierz organizację. Aktywna: Studio Demo",
    });
    expect(switcher.closest("[data-slot='sidebar-header']")).toBeVisible();
    expect(
      document.querySelector(
        "[data-site-header] [aria-label^='Wybierz organizację']",
      ),
    ).toBeNull();

    fireEvent.pointerDown(switcher, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Studio Demo/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(menu).getByRole("menuitem", { name: /Druga Scena/ })).toBeVisible();
  });

  it("uses the existing logout path from the sidebar footer", async () => {
    renderDashboard({ canAccessAdmin: true });
    openUserMenu();

    fireEvent.click(await screen.findByRole("menuitem", { name: "Wyloguj" }));

    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
    expect(mocks.replace).toHaveBeenCalledWith("/sign-in");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("collapses on desktop and exposes navigation labels as tooltips", async () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Zwiń panel boczny" }));

    expect(document.querySelector("[data-sidebar-state='collapsed']")).toBeVisible();
    const organizationsLink = screen.getByRole("link", { name: "Organizacje" });
    fireEvent.pointerMove(organizationsLink, { pointerType: "mouse" });
    fireEvent.mouseOver(organizationsLink);
    fireEvent.focus(organizationsLink);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Organizacje");
  });

  it("keeps the active organization compact and named by tooltip when collapsed", async () => {
    pathname = "/dashboard/org/demo";
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Zwiń panel boczny" }));

    const switcher = screen.getByRole("button", {
      name: "Wybierz organizację. Aktywna: Studio Demo",
    });
    expect(switcher).toHaveTextContent("SD");
    fireEvent.pointerMove(switcher, { pointerType: "mouse" });
    fireEvent.mouseOver(switcher);
    fireEvent.focus(switcher);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Studio Demo");
  });

  it("opens a mobile drawer and closes it after navigation", async () => {
    window.innerWidth = 390;
    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: "Otwórz menu" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("data-management-theme", "true");
    expect(within(dialog).getByRole("link", { name: "Organizacje" })).toBeVisible();

    fireEvent.click(within(dialog).getByRole("link", { name: "Organizacje" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("switches organization from the mobile Sheet and closes the drawer", async () => {
    pathname = "/dashboard/org/demo";
    window.innerWidth = 390;
    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: "Otwórz menu" }));
    const dialog = await screen.findByRole("dialog");
    const switcher = within(dialog).getByRole("button", {
      name: "Wybierz organizację. Aktywna: Studio Demo",
    });
    fireEvent.pointerDown(switcher, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Druga Scena/ }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

const organizations = [
  {
    id: 1,
    name: "Studio Demo",
    organizationId: "demo",
    role: "owner",
  },
  {
    id: 2,
    name: "Druga Scena",
    organizationId: "second",
    role: "viewer",
  },
];

function renderDashboard({
  canAccessAdmin = true,
  event = null,
}: {
  canAccessAdmin?: boolean;
  event?: { eventId: string; name: string } | null;
} = {}) {
  return render(
    <SidebarProvider
      data-management-theme="true"
      className="bg-sidebar text-foreground"
    >
      <DashboardShell
        organizations={organizations}
        operatorName="Jan Operator"
        email="jan@example.test"
        canAccessAdmin={canAccessAdmin}
      >
        {event ? (
          <EventSidebarBridge event={event}>
            <h1>Treść dashboardu</h1>
          </EventSidebarBridge>
        ) : (
          <h1>Treść dashboardu</h1>
        )}
      </DashboardShell>
    </SidebarProvider>,
  );
}

function openUserMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Menu użytkownika: Jan Operator" }),
    { button: 0, ctrlKey: false, pointerType: "mouse" },
  );
}
