// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  EventOverview,
  type EventOverviewModel,
} from "@/components/operator/event-overview";
import type { DashboardEventLifecycleStatus } from "@/lib/dashboard-event-lifecycle";
import type { DashboardOrganizationRole } from "@/lib/dashboard-organization-access";

const eventId = "7c2ec4fa-6089-4fd3-a0ea-032d33adbdda";
const eventPath = `/dashboard/org/demo/events/${eventId}`;

describe("event overview", () => {
  it.each([
    ["owner", "Zarządzaj kolejką", "Zarządzaj ustawieniami", true],
    ["manager", "Zarządzaj kolejką", "Zarządzaj ustawieniami", true],
    ["operator", "Zarządzaj kolejką", "Zobacz ustawienia", true],
    ["viewer", "Zobacz kolejkę", "Zobacz ustawienia", false],
  ] as const)(
    "renders the %s action contract",
    (role, queueLabel, settingsLabel, canShare) => {
      renderOverview({ role });

      expect(screen.getByRole("link", { name: queueLabel })).toHaveAttribute(
        "href",
        `${eventPath}/queue`,
      );
      expect(
        screen.getByRole("link", { name: settingsLabel }),
      ).toHaveAttribute("href", `${eventPath}/settings`);

      const shareLink = screen.queryByRole("link", {
        name: "Udostępnij link i QR",
      });
      if (canShare) {
        expect(shareLink).toHaveAttribute("href", `${eventPath}/share`);
      } else {
        expect(shareLink).toBeNull();
      }
    },
  );

  it.each([
    ["scheduled", "Oczekuje na rozpoczęcie", "Zaplanowane"],
    ["active", "Wydarzenie trwa", "Otwarte"],
    ["closed", "Wydarzenie zakończone", "Zamknięte"],
    ["cancelled", "Wydarzenie anulowane", "Zamknięte"],
  ] as const)(
    "reflects the %s lifecycle in requests without duplicating the shell status",
    (lifecycle, lifecycleTitle, requestState) => {
      const { container } = renderOverview({ lifecycle });

      expect(screen.queryByText(lifecycleTitle)).toBeNull();
      expect(screen.getByText(requestState)).toBeVisible();
      expect(container.querySelector("[data-slot='badge']")).toBeNull();
    },
  );

  it.each([
    [true, "Otwarte"],
    [false, "Wyłączone"],
  ] as const)(
    "shows song requests enabled=%s without relying on color",
    (songRequestsEnabled, state) => {
      renderOverview({ songRequestsEnabled });

      const item = screen.getByText("Zgłoszenia piosenek").closest("[data-slot='item']");
      expect(within(item as HTMLElement).getByText(state)).toBeVisible();
      expect(item?.querySelector("svg")).not.toBeNull();
    },
  );

  it.each([
    [true, "Widoczna"],
    [false, "Ukryta"],
  ] as const)("shows public queue enabled=%s", (publicQueueEnabled, state) => {
    renderOverview({ publicQueueEnabled });

    const item = screen.getByText("Publiczna kolejka").closest("[data-slot='item']");
    expect(within(item as HTMLElement).getByText(state)).toBeVisible();
  });

  it("renders valid configured public links and protects long values from overflow", () => {
    const facebookUrl =
      "https://www.facebook.com/events/bardzo-dlugi-identyfikator-wydarzenia-testowego";
    const { container } = renderOverview({ facebookUrl });

    expect(
      screen.getByRole("link", {
        name: "Otwórz stronę wydarzenia, otwiera w nowej karcie",
      }),
    ).toHaveAttribute("href", "/events/wieczor-testowy");
    expect(
      screen.getByRole("link", {
        name: "Otwórz wydarzenie na Facebooku, otwiera w nowej karcie",
      }),
    ).toHaveAttribute("href", facebookUrl);
    expect(screen.getByText("Skonfigurowano")).toBeVisible();
    expect(screen.queryByText(facebookUrl)).toBeNull();
    expect(container.querySelector("a[href='']")).toBeNull();
    expect(container.querySelector("a[href='#']")).toBeNull();
  });

  it.each([
    [null, "Brak poprawnego adresu"],
    ["nie poprawny slug", "Brak poprawnego adresu"],
  ] as const)(
    "does not render a broken public link for slug %s",
    (slug, publicState) => {
      renderOverview({ slug });

      expect(
        screen.queryByRole("link", {
          name: "Otwórz stronę wydarzenia, otwiera w nowej karcie",
        }),
      ).toBeNull();
      expect(screen.getByText(publicState)).toBeVisible();
    },
  );

  it("does not expose an unpublished page and offers completion only to a manager", () => {
    const first = renderOverview({ facebookUrl: null, publishedAt: null });

    expect(screen.getByText("Nieopublikowana")).toBeVisible();
    expect(screen.getByRole("link", { name: "Uzupełnij" })).toHaveAttribute(
      "href",
      `${eventPath}/settings`,
    );
    expect(
      screen.queryByRole("link", {
        name: "Otwórz stronę wydarzenia, otwiera w nowej karcie",
      }),
    ).toBeNull();

    first.unmount();
    renderOverview({ facebookUrl: null, publishedAt: null, role: "viewer" });
    expect(screen.queryByRole("link", { name: "Uzupełnij" })).toBeNull();
  });

  it("keeps the shell-owned document outline and avoids dashboard filler", () => {
    const { container } = renderOverview();

    expect(
      screen.getByRole("heading", { level: 2, name: "Przegląd wydarzenia" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 3, name: "Dostęp publiczny" }),
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(container.querySelector("main")).toBeNull();
    expect(container.querySelector("[data-event-overview]")).toBeVisible();
    expect(container).not.toHaveTextContent(/KPI|statystyk|wykres/i);
  });
});

function renderOverview(
  overrides: {
    role?: DashboardOrganizationRole;
    lifecycle?: DashboardEventLifecycleStatus;
    songRequestsEnabled?: boolean;
    publicQueueEnabled?: boolean;
    slug?: string | null;
    facebookUrl?: string | null;
    publishedAt?: Date | null;
  } = {},
) {
  const overview: EventOverviewModel = {
    organizationId: "demo",
    role: overrides.role ?? "owner",
    event: {
      publicId: eventId,
      lifecycle: overrides.lifecycle ?? "active",
      visibility: "public",
      publishedAt:
        overrides.publishedAt === undefined
          ? new Date("2026-08-16T12:00:00.000Z")
          : overrides.publishedAt,
      slug:
        overrides.slug === undefined ? "wieczor-testowy" : overrides.slug,
      facebookUrl:
        overrides.facebookUrl === undefined
          ? "https://www.facebook.com/events/123456789"
          : overrides.facebookUrl,
      isActivePublicEvent: true,
      songRequestsEnabled: overrides.songRequestsEnabled ?? true,
      publicQueueEnabled: overrides.publicQueueEnabled ?? true,
      publicShowSongTitles: true,
    },
  };

  return render(<EventOverview overview={overview} />);
}
