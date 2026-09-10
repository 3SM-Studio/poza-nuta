// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventWorkspaceHeader } from "@/components/operator/event-workspace-header";
import {
  EventWorkspaceShell,
  type EventWorkspaceModel,
} from "@/components/operator/event-workspace-shell";
import { canManageDashboardEventQueue } from "@/lib/dashboard-event-queue";
import {
  canManageDashboardOrganizationEvent,
  canShareDashboardOrganizationEvent,
} from "@/lib/dashboard-organization-access";

describe("event workspace role contract", () => {
  it.each([
    ["owner", true, true, true],
    ["manager", true, true, true],
    ["operator", true, false, true],
    ["viewer", false, false, false],
  ] as const)(
    "maps %s to share, settings management, and queue management",
    (role, canShare, canManageSettings, canManageQueue) => {
      expect(canShareDashboardOrganizationEvent(role)).toBe(canShare);
      expect(canManageDashboardOrganizationEvent(role)).toBe(
        canManageSettings,
      );
      expect(canManageDashboardEventQueue(role)).toBe(canManageQueue);
    },
  );
});

describe("event workspace shell", () => {
  it("owns the event header and shared content container without local navigation", () => {
    render(
      <EventWorkspaceShell workspace={createWorkspace()}>
        <p>Treść wydarzenia</p>
      </EventWorkspaceShell>,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Treść wydarzenia")).toBeVisible();
    expect(
      screen.queryByRole("navigation", { name: "Nawigacja wydarzenia" }),
    ).toBeNull();
  });
});

describe("event workspace header", () => {
  it("renders one untruncated H1, status text with an icon, and omits a missing location", () => {
    const longName =
      "Bardzo długie polskie wydarzenie karaoke bez skracania nazwy nawet na małym ekranie";

    render(
      <EventWorkspaceHeader
        event={{
          name: longName,
          venue: null,
          city: null,
          startsAt: new Date("2026-08-16T18:00:00.000Z"),
          closesAt: new Date("2026-08-17T02:00:00.000Z"),
          lifecycle: "active",
        }}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const heading = screen.getByRole("heading", { name: longName });
    expect(heading.parentElement).toHaveClass("min-w-0");
    expect(heading).toHaveClass("break-words", "[overflow-wrap:anywhere]");
    expect(heading).not.toHaveClass(
      "truncate",
      "overflow-hidden",
      "text-ellipsis",
      "whitespace-nowrap",
    );
    expect(heading).toHaveTextContent(longName);
    const status = screen.getByText("Aktywne");
    expect(status.closest("span")?.querySelector("svg")).not.toBeNull();
    expect(document.querySelector("[data-lucide='map-pin']")).toBeNull();
  });
});

function createWorkspace(): EventWorkspaceModel {
  return {
    event: {
      publicId: "7c2ec4fa-6089-4fd3-a0ea-032d33adbdda",
      name: "Wieczór testowy",
      venue: "Scena główna",
      city: "Warszawa",
      startsAt: new Date("2026-08-16T18:00:00.000Z"),
      closesAt: new Date("2026-08-17T02:00:00.000Z"),
      lifecycle: "active",
      visibility: "private",
      slug: null,
    },
  };
}
