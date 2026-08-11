// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventQueuePanel } from "@/components/operator/event-queue-panel";
import type { DashboardEventQueueItemDto } from "@/components/operator/event-queue-api";
import type { DashboardEventQueueRequestStatus } from "@/lib/dashboard-event-queue";
import type { QueueRealtimeInvalidateReason } from "@/lib/queue-realtime";

const { dnd, getQueue, moveRequest, realtime, runAction, toastInfo, toastSuccess } =
  vi.hoisted(() => ({
    dnd: {
      dragEnd: null as ((event: DragEndEvent) => void) | null,
    },
    getQueue: vi.fn(),
    moveRequest: vi.fn(),
    realtime: {
      invalidate: null as
        | ((
            reason: QueueRealtimeInvalidateReason,
            signal: AbortSignal,
          ) => Promise<void>)
        | null,
    },
    runAction: vi.fn(),
    toastInfo: vi.fn(),
    toastSuccess: vi.fn(),
  }));

vi.mock("@dnd-kit/core", () => ({
  closestCorners: vi.fn(),
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragEnd: (event: DragEndEvent) => void;
  }) => {
    dnd.dragEnd = onDragEnd;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
  KeyboardSensor: class KeyboardSensor {},
  PointerSensor: class PointerSensor {},
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn((...sensors: unknown[]) => sensors),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    isDragging: false,
    listeners: {},
    setActivatorNodeRef: vi.fn(),
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
  }),
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: vi.fn(() => undefined) } },
}));

vi.mock("sonner", () => ({
  toast: { info: toastInfo, success: toastSuccess },
}));

vi.mock("@/components/operator/event-queue-api", () => ({
  getDashboardEventQueue: getQueue,
  moveDashboardEventQueueRequest: moveRequest,
  runDashboardEventQueueAction: runAction,
}));

vi.mock("@/components/operator/use-dashboard-queue-realtime", () => ({
  useDashboardQueueRealtime: (
    _eventId: number,
    onInvalidate: (
      reason: QueueRealtimeInvalidateReason,
      signal: AbortSignal,
    ) => Promise<void>,
  ) => {
    realtime.invalidate = onInvalidate;
    return "live";
  },
}));

const statuses: DashboardEventQueueRequestStatus[] = [
  "pending",
  "approved",
  "now",
  "done",
  "skipped",
  "rejected",
];

describe("EventQueuePanel", () => {
  beforeEach(() => {
    getQueue.mockReset();
    dnd.dragEnd = null;
    moveRequest.mockReset();
    realtime.invalidate = null;
    runAction.mockReset();
    toastInfo.mockReset();
    toastSuccess.mockReset();
  });

  it("renders every request status with text, icon, and a semantic tone", () => {
    renderPanel(
      statuses.map((status, index) => makeItem(index + 1, status)),
      false,
    );

    const labels = [
      "Oczekujące",
      "Zaakceptowane",
      "W trakcie",
      "Zagrane",
      "Pominięte",
      "Odrzucone",
    ];

    for (const [index, status] of statuses.entries()) {
      const badge = screen
        .getAllByText(labels[index])
        .map((element) => element.closest("[data-request-status]"))
        .find(Boolean);
      expect(badge).toHaveAttribute("data-request-status", status);
      expect(badge?.querySelector("svg")).not.toBeNull();
    }
  });

  it("separates pending, approved, and rejected requests into queue lanes", () => {
    renderPanel([
      makeItem(1, "pending"),
      makeItem(2, "approved"),
      makeItem(3, "rejected"),
    ]);

    expect(
      within(document.querySelector('[data-queue-lane="pending"]')!).getByText(
        "Singer 1",
      ),
    ).toBeInTheDocument();
    expect(
      within(document.querySelector('[data-queue-lane="approved"]')!).getByText(
        "Singer 2",
      ),
    ).toBeInTheDocument();
    expect(
      within(document.querySelector('[data-queue-lane="rejected"]')!).getByText(
        "Singer 3",
      ),
    ).toBeInTheDocument();
  });

  it("moves a dragged request between lanes immediately and persists it in the background", async () => {
    const pending = makeItem(1, "pending");
    const approved = makeItem(2, "approved");
    const accepted = {
      ...pending,
      status: "approved" as const,
      position: 2,
      version: 2,
    };
    const moved = { ...accepted, position: 1, version: 3 };
    let confirmAction!: (value: {
      request: DashboardEventQueueItemDto;
    }) => void;

    runAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          confirmAction = resolve;
        }),
    );
    moveRequest.mockResolvedValue({ moved: true, request: moved });
    getQueue.mockResolvedValue({
      items: [moved, { ...approved, position: 2 }],
    });
    renderPanel([pending, approved]);

    act(() => {
      dnd.dragEnd?.({
        active: {
          data: {
            current: { type: "request", requestId: 1, lane: "pending" },
          },
        },
        over: {
          data: {
            current: { type: "request", requestId: 2, lane: "approved" },
          },
        },
      } as unknown as DragEndEvent);
    });

    expect(
      within(document.querySelector('[data-queue-lane="approved"]')!).getByText(
        "Singer 1",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(runAction).toHaveBeenCalledWith(
        "organization-test",
        "123e4567-e89b-42d3-a456-426614174000",
        1,
        "approve",
      ),
    );
    expect(moveRequest).not.toHaveBeenCalled();

    confirmAction({ request: accepted });

    await waitFor(() =>
      expect(moveRequest).toHaveBeenCalledWith(
        "organization-test",
        "123e4567-e89b-42d3-a456-426614174000",
        1,
        { targetPosition: 1 },
      ),
    );
    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
  });

  it("requires destructive confirmation before rejecting a request", async () => {
    const pending = makeItem(1, "pending");
    const rejected = { ...pending, status: "rejected" as const, version: 2 };
    runAction.mockResolvedValue({
      request: rejected,
    });
    getQueue.mockResolvedValue({ items: [rejected] });
    renderPanel([pending]);

    fireEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAttribute("data-management-theme", "true");
    expect(runAction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Anuluj" }));
    expect(runAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Odrzuć zgłoszenie",
      }),
    );

    await waitFor(() => expect(runAction).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole("button", { name: /Przywr/ }),
    ).toBeEnabled();
    expect(screen.queryByText(/Zmieniono status/)).not.toBeInTheDocument();
  });

  it("keeps an optimistic action visible while Realtime waits for the mutation", async () => {
    const pending = makeItem(1, "pending");
    const approved = { ...pending, status: "approved" as const, version: 2 };
    let confirmAction!: (value: {
      request: DashboardEventQueueItemDto;
    }) => void;

    runAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          confirmAction = resolve;
        }),
    );
    getQueue.mockResolvedValue({ items: [approved] });
    renderPanel([pending]);

    fireEvent.click(screen.getByRole("button", { name: "Zaakceptuj" }));

    expect(
      await screen.findByRole("button", {
        name: /Ustaw jako aktualnie/,
      }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: /Odśwież/ })).toBeEnabled();
    expect(runAction).toHaveBeenCalledOnce();

    await realtime.invalidate?.("broadcast", new AbortController().signal);
    expect(getQueue).not.toHaveBeenCalled();

    confirmAction({ request: approved });

    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("button", {
        name: /Ustaw jako aktualnie/,
      }),
    ).toBeInTheDocument();
  });

  it("applies repeated moves locally and serializes their background writes", async () => {
    const first = makeItem(1, "approved");
    const second = makeItem(2, "approved");
    const third = makeItem(3, "approved");
    const finalThird = { ...third, position: 1, version: 3 };
    let confirmFirstMove!: (value: {
      moved: boolean;
      request: DashboardEventQueueItemDto;
    }) => void;

    moveRequest
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            confirmFirstMove = resolve;
          }),
      )
      .mockResolvedValueOnce({ moved: true, request: finalThird });
    getQueue.mockResolvedValue({
      items: [finalThird, { ...first, position: 2 }, { ...second, position: 3 }],
    });
    renderPanel([first, second, third]);

    const thirdRow = screen.getByText("Singer 3").closest("article");
    expect(thirdRow).not.toBeNull();
    const moveUp = within(thirdRow!).getByRole("button", {
      name: /Przesuń zgłoszenie w górę/,
    });

    fireEvent.click(moveUp);
    await waitFor(() => expect(moveRequest).toHaveBeenCalledOnce());
    expect(moveUp).toBeEnabled();

    fireEvent.click(moveUp);
    expect(within(thirdRow!).getByText("Pozycja: 1")).toBeInTheDocument();
    expect(moveRequest).toHaveBeenCalledOnce();

    confirmFirstMove({
      moved: true,
      request: { ...third, position: 2, version: 2 },
    });

    await waitFor(() => expect(moveRequest).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
  });
});

function renderPanel(
  initialItems: DashboardEventQueueItemDto[],
  canManage = true,
) {
  return render(
    <EventQueuePanel
      organizationId="organization-test"
      eventId="123e4567-e89b-42d3-a456-426614174000"
      realtimeEventId={1}
      canManage={canManage}
      initialItems={initialItems}
    />,
  );
}

function makeItem(
  id: number,
  status: DashboardEventQueueRequestStatus,
): DashboardEventQueueItemDto {
  return {
    id,
    eventId: 1,
    songId: id,
    singerName: `Singer ${id}`,
    displayName: `Singer ${id}`,
    note: null,
    status,
    position: status === "approved" ? id : 0,
    requestedBy: "public",
    version: 1,
    createdAt: "2026-07-18T18:00:00.000Z",
    updatedAt: "2026-07-18T18:00:00.000Z",
    startedAt: status === "now" ? "2026-07-18T18:01:00.000Z" : null,
    completedAt: status === "done" ? "2026-07-18T18:02:00.000Z" : null,
    song: {
      title: `Song ${id}`,
      artist: "Artist",
      source: "ising",
      durationSeconds: 180,
    },
  };
}
