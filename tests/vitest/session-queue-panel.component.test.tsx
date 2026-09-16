// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SessionQueuePanel } from "@/components/public/session-queue-panel";

const queueWithCurrent = {
  enabled: true,
  showSongTitles: true,
  items: [
    {
      id: 1,
      singerName: "Ola",
      status: "now" as const,
      position: 1,
      createdAt: "2026-09-15T18:00:00.000Z",
      title: "Dancing Queen",
      artist: "ABBA",
    },
    {
      id: 2,
      singerName: "Maks",
      status: "approved" as const,
      position: 2,
      createdAt: "2026-09-15T18:02:00.000Z",
      title: "Zanim pójdę",
      artist: "Happysad",
    },
  ],
};

function QueuePanelHarness({
  queue = queueWithCurrent,
}: {
  queue?: typeof queueWithCurrent | { enabled: boolean; showSongTitles: boolean; items: [] };
}) {
  const [open, setOpen] = useState(false);

  return (
    <SessionQueuePanel
      message={null}
      onOpen={vi.fn()}
      onOpenChange={setOpen}
      onRefresh={vi.fn()}
      open={open}
      queue={queue}
      refreshing={false}
    />
  );
}

describe("SessionQueuePanel", () => {
  it("renders an accessible persistent queue landmark alongside the mobile queue control", () => {
    render(<QueuePanelHarness />);

    const desktopPanel = screen.getByRole("complementary", { name: "Kolejka sesji" });
    expect(desktopPanel).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Otwórz kolejkę" })).toHaveLength(1);
    expect(within(desktopPanel).getByText("Dancing Queen")).toBeVisible();
  });

  it("expands from the mobile bar and collapses through its labelled control", async () => {
    render(<QueuePanelHarness />);

    const trigger = screen.getByRole("button", { name: "Otwórz kolejkę" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(await screen.findByRole("dialog", { name: "Kolejka" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Zwiń kolejkę" }));
    expect(screen.queryByRole("dialog", { name: "Kolejka" })).not.toBeInTheDocument();
  });

  it("uses a real queue summary when no item has status now", () => {
    render(
      <QueuePanelHarness
        queue={{
          ...queueWithCurrent,
          items: queueWithCurrent.items.slice(1),
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Otwórz kolejkę" })).toHaveTextContent(
      "Kolejka1 utwór",
    );
    expect(screen.queryByText("Teraz gramy")).not.toBeInTheDocument();
  });

  it("keeps the queue affordance and empty state when there are no public items", () => {
    render(
      <QueuePanelHarness
        queue={{ enabled: true, showSongTitles: true, items: [] }}
      />,
    );

    expect(screen.getByRole("button", { name: "Otwórz kolejkę" })).toHaveTextContent(
      "KolejkaBrak utworów",
    );
    expect(
      screen.getByText("Kolejka nie ma jeszcze publicznie widocznych zgłoszeń."),
    ).toBeVisible();
  });

  it("renders a long queue without creating a second current-song row", () => {
    const longQueue = {
      ...queueWithCurrent,
      items: Array.from({ length: 30 }, (_, index) => ({
        ...queueWithCurrent.items[index === 0 ? 0 : 1]!,
        id: index + 1,
        position: index + 1,
        status: (index === 0 ? "now" : "approved") as "now" | "approved",
      })),
    };
    render(<QueuePanelHarness queue={longQueue} />);

    expect(screen.getByText("30 utworów w kolejce")).toBeVisible();
    const desktopPanel = screen.getByRole("complementary", { name: "Kolejka sesji" });
    expect(within(desktopPanel).getAllByText("Dancing Queen")).toHaveLength(1);
    expect(within(desktopPanel).getAllByText("#30")).toHaveLength(1);
  });
});
