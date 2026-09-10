// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EventManagementPanel,
  type EventManagementAction,
} from "@/components/operator/event-management-panel";

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess },
}));

const action: EventManagementAction = async () => ({
  issues: [],
  message: null,
});

describe("EventManagementPanel", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows no settings actions when the role cannot manage the event", () => {
    renderPanel({
      canManage: false,
      canReopen: false,
      canRotateCode: false,
    });

    expect(screen.getByText("Zarządzanie jest niedostępne.")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("uses Sonner for a successful action and a persistent reopen Alert", () => {
    renderPanel({
      canManage: false,
      canReopen: true,
      canRotateCode: false,
      reopenDeadline: "2026-07-18T12:01:30.000Z",
      successMessage: "Wydarzenie zostało ponownie otwarte.",
    });

    expect(toastSuccess).toHaveBeenCalledWith(
      "Wydarzenie zostało ponownie otwarte.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Możesz je przywrócić jeszcze przez 01:30",
    );
    expect(screen.queryByText("Wydarzenie zostało ponownie otwarte.")).toBeNull();
  });

  it("binds portaled confirmations to the close and extension forms", async () => {
    vi.useRealTimers();
    renderPanel({ canManage: true, canReopen: false, canRotateCode: false });

    fireEvent.click(
      screen.getByRole("button", { name: "Zamknij wydarzenie teraz" }),
    );
    let dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("button", { name: "Zamknij wydarzenie teraz" }),
    ).toHaveAttribute("form", "event-close-form");
    fireEvent.click(within(dialog).getByRole("button", { name: "Anuluj" }));

    fireEvent.click(screen.getByRole("button", { name: "+20 min" }));
    dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "+20 min" });
    expect(confirm).toHaveAttribute("form", "event-extend-form");
    expect(confirm).toHaveAttribute("name", "minutes");
    expect(confirm).toHaveAttribute("value", "20");
  });

  it("keeps code rotation behind an AlertDialog without changing the stable QR", async () => {
    vi.useRealTimers();
    renderPanel({ canManage: true, canReopen: false, canRotateCode: true });

    fireEvent.click(screen.getByRole("button", { name: "Zmień kod sesji" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Kanoniczny link i QR pozostaną bez zmian.");
    expect(
      within(dialog).getByRole("button", { name: "Zmień kod" }),
    ).toHaveAttribute("form", "event-session-code-rotation-form");
  });
});

function renderPanel(
  overrides: Partial<ComponentProps<typeof EventManagementPanel>> = {},
) {
  return render(
    <EventManagementPanel
      canManage
      manageBlockedReason="Zarządzanie jest niedostępne."
      initialValues={{
        title: "Testowe wydarzenie",
        venue: "",
        city: "",
        slug: "",
        visibility: "private",
        startsAtInputValue: "2026-07-18T14:00",
        autoCloseAtInputValue: "2026-07-18T20:00",
        facebookUrl: "",
        songRequestsEnabled: true,
        publicQueueEnabled: true,
        publicShowSongTitles: true,
        isActivePublicEvent: true,
      }}
      showClosingWarning={false}
      detailsAction={action}
      extendAction={action}
      closeAction={action}
      reopenAction={action}
      rotateCodeAction={action}
      canReopen={false}
      reopenDeadline={null}
      canRotateCode={false}
      successMessage={null}
      {...overrides}
    />,
  );
}
