// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardShell } from "@/components/operator/dashboard-shell";
import { EventSidebarBridge } from "@/components/operator/event-sidebar-context";
import type { OrganizerSidebarOrganization } from "@/components/operator/organizer-sidebar";
import type { DashboardOrganizationRole } from "@/lib/dashboard-organization-access";
import { SidebarProvider } from "@/components/ui/sidebar";

let pathname = "/dashboard/organizations";
const eventId = "7c2ec4fa-6089-4fd3-a0ea-032d33adbdda";
const eventPath = `/dashboard/org/demo/events/${eventId}`;
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

  it.each([
    ["Przegląd", eventPath],
    ["Kolejka", `${eventPath}/queue`],
    ["Link i QR", `${eventPath}/share`],
    ["Ustawienia", `${eventPath}/settings`],
  ])("keeps one event navigation set and marks %s active", async (label, href) => {
    pathname = href;
    renderDashboard({ event: { eventId, name: "Wieczór testowy" } });

    expect(await screen.findAllByText("Wieczór testowy")).toHaveLength(2);
    const eventSections = document.querySelectorAll(
      '[aria-label="Nawigacja wydarzenia"]',
    );
    expect(eventSections).toHaveLength(1);
    const eventNavigation = within(eventSections[0] as HTMLElement);
    const eventLinks = eventNavigation
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith(eventPath));
    expect(eventLinks).toHaveLength(4);
    expect(eventNavigation.getByRole("link", { name: label })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      eventLinks.filter((link) => link.hasAttribute("aria-current")),
    ).toHaveLength(1);
    expect(
      eventNavigation.getByRole("link", { name: "Przegląd" }),
    ).toHaveAttribute("href", eventPath);
    expect(eventNavigation.getByRole("link", { name: "Kolejka" })).toHaveAttribute(
      "href",
      `${eventPath}/queue`,
    );
    expect(
      eventNavigation.getByRole("link", { name: "Link i QR" }),
    ).toHaveAttribute("href", `${eventPath}/share`);
    expect(
      eventNavigation.getByRole("link", { name: "Ustawienia" }),
    ).toHaveAttribute("href", `${eventPath}/settings`);
    expect(
      eventNavigation.getByRole("link", { name: "Powrót do wydarzeń" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Zespół" })).toBeVisible();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText("Studio Demo")).toBeVisible();
    expect(within(breadcrumb).getByText("Wieczór testowy")).toBeVisible();
    expect(
      within(breadcrumb).getByText(
        label === "Przegląd" ? "Wieczór testowy" : label,
      ),
    ).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      document.querySelector(`[data-site-header-title='${label}']`),
    ).toBeVisible();
  });

  it("hides event sharing from a viewer while keeping the other event links", () => {
    pathname = eventPath;
    renderDashboard({
      event: { eventId, name: "Wieczór testowy" },
      organizationRole: "viewer",
    });

    const eventNavigation = within(
      document.querySelector(
        '[aria-label="Nawigacja wydarzenia"]',
      ) as HTMLElement,
    );
    expect(eventNavigation.queryByRole("link", { name: "Link i QR" })).toBeNull();
    expect(eventNavigation.getByRole("link", { name: "Przegląd" })).toBeVisible();
    expect(eventNavigation.getByRole("link", { name: "Kolejka" })).toBeVisible();
    expect(eventNavigation.getByRole("link", { name: "Ustawienia" })).toBeVisible();
  });

  it.each([
    ["organization overview", "/dashboard/org/demo", "Przegląd"],
    ["organization events", "/dashboard/org/demo/events", "Wydarzenia"],
    ["new event", "/dashboard/org/demo/events/new", "Wydarzenia"],
    ["organization settings", "/dashboard/org/demo/settings", "Ustawienia"],
    ["dashboard root", "/dashboard", "Panel"],
  ])("uses the standard breadcrumb fallback on %s", (_case, href, title) => {
    pathname = href;
    renderDashboard();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText("Panel organizatora")).toBeVisible();
    expect(
      within(breadcrumb).getByText(title, {
        selector: "[data-slot='breadcrumb-page']",
      }),
    ).toBeVisible();
    expect(within(breadcrumb).queryByText("Wydarzenie")).toBeNull();
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

  it("keeps the event heading and user footer fixed around scrollable navigation", async () => {
    pathname = eventPath;
    renderDashboard({ event: { eventId, name: "Wieczór testowy" } });

    const sidebar = screen.getByRole("complementary", {
      name: "Nawigacja panelu organizatora",
    });
    const header = sidebar.querySelector<HTMLElement>(
      "[data-slot='sidebar-header']",
    );
    const scrollArea = sidebar.querySelector<HTMLElement>(
      "[data-sidebar-navigation-scroll]",
    );
    const viewport = scrollArea?.querySelector<HTMLElement>(
      "[data-slot='scroll-area-viewport']",
    );
    const footer = sidebar.querySelector<HTMLElement>(
      "[data-slot='sidebar-footer']",
    );
    const eventNavigation = sidebar.querySelector<HTMLElement>(
      '[aria-label="Nawigacja wydarzenia"]',
    );

    expect(within(header as HTMLElement).getByText("Wieczór testowy")).toBeVisible();
    expect(scrollArea).toContainElement(eventNavigation);
    expect(viewport).toHaveClass("overscroll-contain");
    expect(viewport).toHaveAttribute("tabindex", "0");
    expect(footer).toContainElement(
      screen.getByRole("button", { name: "Menu użytkownika: Jan Operator" }),
    );
    expect(
      header?.compareDocumentPosition(scrollArea as Node) ?? 0,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      scrollArea?.compareDocumentPosition(footer as Node) ?? 0,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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

  it("exposes event links in the mobile drawer and closes it after navigation", async () => {
    pathname = eventPath;
    window.innerWidth = 390;
    renderDashboard({ event: { eventId, name: "Wieczór testowy" } });

    fireEvent.click(screen.getByRole("button", { name: "Otwórz menu" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("data-management-theme", "true");
    const eventNavigation = within(
      dialog.querySelector(
        '[aria-label="Nawigacja wydarzenia"]',
      ) as HTMLElement,
    );
    expect(eventNavigation.getByRole("link", { name: "Kolejka" })).toBeVisible();

    fireEvent.click(eventNavigation.getByRole("link", { name: "Kolejka" }));
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

const organizations: OrganizerSidebarOrganization[] = [
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
  organizationRole = "owner",
}: {
  canAccessAdmin?: boolean;
  event?: { eventId: string; name: string } | null;
  organizationRole?: DashboardOrganizationRole;
} = {}) {
  const testOrganizations = organizations.map((organization) =>
    organization.organizationId === "demo"
      ? { ...organization, role: organizationRole }
      : organization,
  );

  return render(
    <SidebarProvider
      data-management-theme="true"
      className="bg-sidebar text-foreground"
    >
      <DashboardShell
        organizations={testOrganizations}
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
