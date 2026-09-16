// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionQueueList } from "@/components/public/session-queue-list";

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

describe("SessionQueueList", () => {
  it("uses only an explicit now item for the current-song bar and does not duplicate it below", () => {
    render(<SessionQueueList message={null} onRefresh={vi.fn()} queue={queueWithCurrent} refreshing={false} />);

    expect(screen.getByRole("region", { name: "Aktualnie wykonywany utwór" })).toHaveTextContent("Dancing Queen");
    expect(screen.getAllByText("Dancing Queen")).toHaveLength(1);
    expect(screen.queryByText("#1")).not.toBeInTheDocument();
    expect(screen.getByText("#2")).toBeVisible();
  });

  it("does not invent a current song when the queue contains no now status", () => {
    render(
      <SessionQueueList
        message={null}
        onRefresh={vi.fn()}
        queue={{ ...queueWithCurrent, items: queueWithCurrent.items.slice(1) }}
        refreshing={false}
      />,
    );

    expect(screen.queryByRole("region", { name: "Aktualnie wykonywany utwór" })).not.toBeInTheDocument();
    expect(screen.getByText("#2")).toBeVisible();
  });

  it("counts every public queue item, including the explicit current song", () => {
    render(<SessionQueueList message={null} onRefresh={vi.fn()} queue={queueWithCurrent} refreshing={false} />);

    expect(screen.getByText("2 utwory w kolejce")).toBeVisible();
  });
});
