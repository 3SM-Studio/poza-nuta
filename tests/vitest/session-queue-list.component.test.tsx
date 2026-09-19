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
    expect(screen.getByRole("region", { name: "Aktualnie wykonywany utwór" })).toHaveTextContent("Śpiewa: Ola");
    expect(screen.getByText("Śpiewa: Maks")).toBeVisible();
  });

  it("keeps the participant nickname visible alongside the own-request badge", () => {
    render(<SessionQueueList message={null} onRefresh={vi.fn()} ownSingerName="Maks" queue={queueWithCurrent} refreshing={false} />);

    expect(screen.getByText("Śpiewa: Maks")).toBeVisible();
    expect(screen.getByText("Twoje")).toBeVisible();
    expect(screen.getByText("Śpiewa: Ola")).toBeVisible();
  });

  it("omits the participant line for legacy queue rows without a name", () => {
    render(<SessionQueueList message={null} onRefresh={vi.fn()} queue={{ ...queueWithCurrent, items: [{ ...queueWithCurrent.items[1], singerName: "   " }] }} refreshing={false} />);

    expect(screen.queryByText(/^Śpiewa:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Twoje")).not.toBeInTheDocument();
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

  it("does not repeat the singer line when titles are hidden", () => {
    render(<SessionQueueList message={null} onRefresh={vi.fn()} queue={{ ...queueWithCurrent, showSongTitles: false }} refreshing={false} />);
    expect(screen.getAllByText("Ola")).toHaveLength(1);
    expect(screen.getAllByText("Maks")).toHaveLength(1);
    expect(screen.queryByText("Śpiewa: Ola")).not.toBeInTheDocument();
    expect(screen.queryByText("Śpiewa: Maks")).not.toBeInTheDocument();
  });
});
