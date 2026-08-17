// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  Collision,
  CollisionDetection,
  DragEndEvent,
  DragStartEvent,
  KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventQueuePanel } from "@/components/operator/event-queue-panel";
import { OperatorClientError } from "@/components/operator/api";
import type { DashboardEventQueueItemDto } from "@/components/operator/event-queue-api";
import type { DashboardEventQueueRequestStatus } from "@/lib/dashboard-event-queue";
import type { DashboardEventLifecycleStatus } from "@/lib/dashboard-event-lifecycle";
import type { QueueRealtimeInvalidateReason } from "@/lib/queue-realtime";
import type { QueueRealtimeConnectionStatus } from "@/lib/queue-realtime";

const {
  closestCorners,
  dnd,
  getQueue,
  moveRequest,
  pointerWithin,
  realtime,
  runAction,
  sortableKeyboardCoordinates,
  toastInfo,
  toastSuccess,
} = vi.hoisted(() => ({
    closestCorners: vi.fn(),
    dnd: {
      collisionDetection: null as CollisionDetection | null,
      contextId: null as string | null,
      dragEnd: null as ((event: DragEndEvent) => void) | null,
      dragStart: null as ((event: DragStartEvent) => void) | null,
      keyboardCoordinates: null as KeyboardCoordinateGetter | null,
    },
    getQueue: vi.fn(),
    moveRequest: vi.fn(),
    pointerWithin: vi.fn(),
    realtime: {
      invalidate: null as
        | ((
            reason: QueueRealtimeInvalidateReason,
            signal: AbortSignal,
          ) => Promise<void>)
        | null,
      status: "live" as QueueRealtimeConnectionStatus,
    },
    runAction: vi.fn(),
    sortableKeyboardCoordinates: vi.fn(),
    toastInfo: vi.fn(),
    toastSuccess: vi.fn(),
  }));

vi.mock("@dnd-kit/core", () => ({
  closestCorners,
  DndContext: ({
    children,
    collisionDetection,
    id,
    onDragEnd,
    onDragStart,
  }: {
    children: ReactNode;
    collisionDetection: CollisionDetection;
    id: string;
    onDragEnd: (event: DragEndEvent) => void;
    onDragStart: (event: DragStartEvent) => void;
  }) => {
    dnd.collisionDetection = collisionDetection;
    dnd.contextId = id;
    dnd.dragEnd = onDragEnd;
    dnd.dragStart = onDragStart;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
  KeyboardSensor: class KeyboardSensor {},
  pointerWithin,
  PointerSensor: class PointerSensor {},
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
  useSensor: vi.fn(
    (
      _sensor: unknown,
      options?: { coordinateGetter?: KeyboardCoordinateGetter },
    ) => {
      if (options?.coordinateGetter) {
        dnd.keyboardCoordinates = options.coordinateGetter;
      }
      return {};
    },
  ),
  useSensors: vi.fn((...sensors: unknown[]) => sensors),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates,
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
    return realtime.status;
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
    closestCorners.mockReset();
    dnd.collisionDetection = null;
    dnd.contextId = null;
    dnd.keyboardCoordinates = null;
    getQueue.mockReset();
    dnd.dragEnd = null;
    dnd.dragStart = null;
    moveRequest.mockReset();
    pointerWithin.mockReset();
    realtime.invalidate = null;
    realtime.status = "live";
    runAction.mockReset();
    sortableKeyboardCoordinates.mockReset();
    toastInfo.mockReset();
    toastSuccess.mockReset();
  });

  it("keeps the viewer queue readable without management actions", () => {
    renderPanel([makeItem(1, "pending")], false);

    expect(screen.getByText("Singer 1")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Rola viewer pozwala przeglądać kolejkę, ale nie zmieniać statusów",
    );
    expect(
      screen.queryByRole("button", { name: /^Zaakceptuj:/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^Odrzuć:/ })).toBeNull();
  });

  it("keeps manual refresh available in read-only lifecycle", async () => {
    const pending = makeItem(1, "pending");
    getQueue.mockResolvedValue({ items: [pending] });
    renderPanel([pending], true, { lifecycle: "closed" });

    fireEvent.click(screen.getByRole("button", { name: "Odśwież" }));

    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    expect(screen.getByText("Singer 1")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Zaakceptuj:/ })).toBeNull();
  });

  it.each([
    ["connecting", "Łączenie…"],
    ["live", "Aktualizacje na żywo"],
    ["unavailable", "Aktualizacje niedostępne"],
  ] as const)("labels the %s Realtime state in text", (status, label) => {
    realtime.status = status;
    renderPanel([]);

    expect(screen.getByText(label)).toBeVisible();
    expect(document.querySelector("[data-realtime-status]")).toHaveAttribute(
      "data-realtime-status",
      status,
    );
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

  it("keeps the operational hierarchy and explicit empty states", () => {
    renderPanel([]);

    expect(
      screen.getByRole("heading", { level: 2, name: "Kolejka operacyjna" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 3, name: "Aktualnie śpiewane" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 3, name: "Oczekujące" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 3, name: "Zaakceptowane" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 3, name: "Odrzucone" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 3, name: "Historia" }),
    ).toBeVisible();
    expect(document.querySelector("[data-queue-empty]")).toHaveTextContent(
      "Brak zgłoszeń",
    );
    expect(screen.getAllByText("Upuść zgłoszenie tutaj")).toHaveLength(3);
    expect(screen.getByText("Historia jest jeszcze pusta.")).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Oczekujące" }),
    ).toHaveAttribute("data-queue-lane", "pending");
    expect(
      screen.getByRole("region", { name: "Zaakceptowane" }),
    ).toHaveAttribute("data-queue-lane", "approved");
    expect(
      screen.getByRole("region", { name: "Odrzucone" }),
    ).toHaveAttribute("data-queue-lane", "rejected");
  });

  it("shows the full action matrix only while an owner can mutate an active queue", () => {
    renderPanel(statuses.map((status, index) => makeItem(index + 1, status)));

    const pendingRow = screen.getByText("Singer 1").closest("article")!;
    const approvedRow = screen.getByText("Singer 2").closest("article")!;
    const currentRow = screen.getByText("Singer 3").closest("article")!;
    const doneRow = screen.getByText("Singer 4").closest("article")!;
    const skippedRow = screen.getByText("Singer 5").closest("article")!;
    const rejectedRow = screen.getByText("Singer 6").closest("article")!;

    expect(within(pendingRow).getByRole("button", { name: /^Zaakceptuj:/ })).toBeVisible();
    expect(within(pendingRow).getByRole("button", { name: /^Odrzuć:/ })).toBeVisible();
    expect(within(approvedRow).getByRole("button", { name: /^Rozpocznij występ:/ })).toBeVisible();
    expect(within(approvedRow).getByRole("button", { name: /^Oznacz jako zagrane:/ })).toBeVisible();
    expect(within(currentRow).getByRole("button", { name: /^Oznacz jako zagrane:/ })).toBeVisible();
    expect(within(doneRow).getByRole("button", { name: /^Przywróć:/ })).toBeVisible();
    expect(within(skippedRow).getByRole("button", { name: /^Przywróć:/ })).toBeVisible();
    expect(within(rejectedRow).getByRole("button", { name: /^Zaakceptuj:/ })).toBeVisible();
    expect(within(rejectedRow).getByRole("button", { name: /^Przywróć:/ })).toBeVisible();
  });

  it("gives repeated actions request-specific names and a clear pending hierarchy", () => {
    renderPanel([makeItem(1, "pending"), makeItem(2, "pending")]);

    const approve = screen.getByRole("button", {
      name: "Zaakceptuj: Singer 1 — Song 1",
    });
    const start = screen.getByRole("button", {
      name: "Rozpocznij występ: Singer 1 — Song 1",
    });

    expect(approve).toHaveAttribute("data-variant", "default");
    expect(start).toHaveAttribute("data-variant", "secondary");
    expect(
      screen.getByRole("button", {
        name: "Odrzuć: Singer 2 — Song 2",
      }),
    ).toHaveAttribute("data-variant", "destructive");
  });

  it.each(["scheduled", "closed", "cancelled"] as const)(
    "keeps a %s event read-only even for a managing role",
    (lifecycle) => {
      renderPanel([makeItem(1, "pending")], true, { lifecycle });

      expect(document.querySelector("[data-queue-closed]")).toBeVisible();
      expect(screen.getByText("Zmiany niedostępne")).toBeVisible();
      expect(screen.queryByRole("button", { name: /^Zaakceptuj:/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Przeciągnij zgłoszenie/ })).toBeNull();
      expect(runAction).not.toHaveBeenCalled();
    },
  );

  it("combines viewer and closed-event guidance into one alert", () => {
    renderPanel([makeItem(1, "pending")], false, { lifecycle: "closed" });

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Rola viewer pozwala przeglądać kolejkę",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Wydarzenie zostało zamknięte",
    );
    expect(screen.getByText("Tylko podgląd")).toBeVisible();
  });

  it("restores keyboard focus to a request after an optimistic lane change", async () => {
    const pending = makeItem(1, "pending");
    const approved = { ...pending, status: "approved" as const, version: 2 };
    const duplicateOutsidePanel = document.createElement("article");
    duplicateOutsidePanel.dataset.queueRequestId = "1";
    duplicateOutsidePanel.tabIndex = -1;
    document.body.prepend(duplicateOutsidePanel);
    runAction.mockResolvedValue({ request: approved });
    getQueue.mockResolvedValue({ items: [approved] });
    renderPanel([pending]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Zaakceptuj: Singer 1 — Song 1",
      }),
      { detail: 0 },
    );

    await waitFor(() =>
      expect(
        screen.getByRole("article", {
          name: "Zgłoszenie: Singer 1 — Song 1",
        }),
      ).toHaveFocus(),
    );
    expect(duplicateOutsidePanel).not.toHaveFocus();
    duplicateOutsidePanel.remove();
  });

  it("returns keyboard focus to the source lane after a failed DnD mutation", async () => {
    const pending = makeItem(1, "pending");
    const mutation = deferred<{ request: DashboardEventQueueItemDto }>();

    runAction.mockImplementation(() => mutation.promise);
    getQueue.mockResolvedValue({ items: [pending] });
    renderPanel([pending]);

    act(() => {
      dnd.dragEnd?.({
        active: {
          data: {
            current: { type: "request", requestId: 1, lane: "pending" },
          },
        },
        over: {
          data: { current: { type: "lane", lane: "approved" } },
        },
      } as unknown as DragEndEvent);
    });

    const optimisticRow = within(
      document.querySelector('[data-queue-lane="approved"]')!,
    ).getByRole("article", { name: "Zgłoszenie: Singer 1 — Song 1" });
    await waitFor(() => expect(optimisticRow).toHaveFocus());

    await act(async () => {
      mutation.reject(
        new OperatorClientError(409, "QUEUE_ACTION_CONFLICT", "Conflict"),
      );
      await Promise.resolve();
    });

    const rolledBackRow = within(
      document.querySelector('[data-queue-lane="pending"]')!,
    ).getByRole("article", { name: "Zgłoszenie: Singer 1 — Song 1" });
    await waitFor(() => expect(rolledBackRow).toHaveFocus());
  });

  it("preserves the source card geometry in the drag overlay across responsive queue layouts", () => {
    renderPanel([makeItem(1, "rejected")]);

    const board = document.querySelector("[data-queue-board]");
    const rejectedLane = document.querySelector(
      '[data-queue-lane="rejected"]',
    );

    expect(board).toHaveClass(
      "grid-cols-1",
      "@min-[48rem]/queue:grid-cols-2",
    );
    expect(dnd.contextId).toBe(
      "event-queue:organization-test:123e4567-e89b-42d3-a456-426614174000",
    );
    expect(board).not.toHaveClass("grid-cols-2", "lg:grid-cols-2");
    expect(rejectedLane).toHaveClass("col-span-full");

    act(() => {
      dnd.dragStart?.({
        active: {
          data: {
            current: { type: "request", requestId: 1, lane: "rejected" },
          },
        },
      } as unknown as DragStartEvent);
    });

    const overlay = document.querySelector("[data-queue-drag-overlay]");

    expect(overlay).toHaveClass(
      "h-full",
      "w-full",
      "[&>article]:h-full",
    );
    expect(overlay?.className).not.toContain("w-[min(");
    expect(overlay?.className).not.toContain("rotate-");
    expect(document.querySelectorAll('[data-queue-request-id="1"]')).toHaveLength(
      1,
    );
  });

  it("restores focus immediately after a no-op drop without stealing it on a later refresh", async () => {
    const rejected = makeItem(1, "rejected");
    getQueue.mockResolvedValue({
      items: [{ ...rejected, version: rejected.version + 1 }],
    });
    renderPanel([rejected]);

    act(() => {
      dnd.dragEnd?.({
        active: {
          data: {
            current: { type: "request", requestId: 1, lane: "rejected" },
          },
        },
        over: {
          data: {
            current: {
              type: "request",
              requestId: 1,
              lane: "rejected",
            },
          },
        },
      } as unknown as DragEndEvent);
    });

    const requestRow = screen.getByRole("article", {
      name: "Zgłoszenie: Singer 1 — Song 1",
    });
    await waitFor(() => expect(requestRow).toHaveFocus());

    const refreshButton = screen.getByRole("button", { name: "Odśwież" });
    refreshButton.focus();
    await act(async () => {
      await realtime.invalidate?.("broadcast", new AbortController().signal);
    });

    expect(refreshButton).toHaveFocus();
  });

  it("uses the pointer position for collisions and falls back for keyboard dragging", () => {
    renderPanel([makeItem(1, "rejected")]);

    const pointerCollisions = [
      { id: "queue-lane:approved" },
    ] as Collision[];
    const keyboardCollisions = [
      { id: "queue-lane:pending" },
    ] as Collision[];
    const activeContainer = { id: "queue-request:1" };
    const targetContainer = { id: "queue-lane:pending" };
    const args = {
      active: { id: activeContainer.id },
      droppableContainers: [activeContainer, targetContainer],
    } as unknown as Parameters<CollisionDetection>[0];

    pointerWithin.mockReturnValueOnce(pointerCollisions).mockReturnValueOnce([]);
    closestCorners.mockReturnValue(keyboardCollisions);

    expect(dnd.collisionDetection?.(args)).toBe(pointerCollisions);
    expect(closestCorners).not.toHaveBeenCalled();
    expect(dnd.collisionDetection?.(args)).toBe(keyboardCollisions);
    expect(closestCorners).toHaveBeenCalledWith({
      ...args,
      droppableContainers: [targetContainer],
    });
  });

  it("moves vertically through request cards in the current lane before another lane", () => {
    renderPanel([
      makeItem(1, "approved"),
      makeItem(2, "approved"),
      makeItem(3, "approved"),
      makeItem(4, "rejected"),
    ]);
    sortableKeyboardCoordinates.mockReturnValue({ x: 999, y: 999 });

    const containers = [
      keyboardRequestContainer(1, "approved", queueRect(0, 0)),
      keyboardRequestContainer(2, "approved", queueRect(0, 100)),
      keyboardRequestContainer(3, "approved", queueRect(0, 200)),
      keyboardRequestContainer(4, "rejected", queueRect(120, 50)),
      keyboardLaneContainer("approved", queueRect(0, 0, 100, 300)),
      keyboardLaneContainer("rejected", queueRect(120, 0, 100, 300)),
    ];

    expect(
      runKeyboardCoordinates("ArrowDown", 1, "approved", containers),
    ).toEqual({ x: 0, y: 100 });
    expect(
      runKeyboardCoordinates("ArrowDown", 2, "approved", containers),
    ).toEqual({ x: 0, y: 200 });
    expect(sortableKeyboardCoordinates).not.toHaveBeenCalled();
  });

  it("moves from the end of a lane into an empty lane drop zone", () => {
    renderPanel([makeItem(1, "approved")]);
    const containers = [
      keyboardRequestContainer(1, "approved", queueRect(0, 0)),
      keyboardLaneContainer("approved", queueRect(0, 0, 100, 100)),
      keyboardLaneContainer("rejected", queueRect(0, 200, 100, 200)),
    ];

    expect(
      runKeyboardCoordinates("ArrowDown", 1, "approved", containers),
    ).toEqual({ x: 0, y: 200 });
  });

  it.each([
    ["rejected", "approved", "approve"],
    ["rejected", "pending", "restore"],
    ["approved", "rejected", "reject"],
  ] as const)(
    "moves a request from %s to an empty %s lane",
    async (sourceLane, targetLane, expectedAction) => {
      const source = makeItem(1, sourceLane);
      const target = {
        ...source,
        status: targetLane,
        position: targetLane === "approved" ? 1 : 0,
        version: 2,
      };

      runAction.mockResolvedValue({ request: target });
      moveRequest.mockResolvedValue({ moved: true, request: target });
      getQueue.mockResolvedValue({ items: [target] });
      renderPanel([source]);

      act(() => {
        dnd.dragEnd?.({
          active: {
            data: {
              current: { type: "request", requestId: 1, lane: sourceLane },
            },
          },
          over: {
            data: {
              current: { type: "lane", lane: targetLane },
            },
          },
        } as unknown as DragEndEvent);
      });

      expect(
        within(
          document.querySelector(`[data-queue-lane="${targetLane}"]`)!,
        ).getByText("Singer 1"),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(runAction).toHaveBeenCalledWith(
          "organization-test",
          "123e4567-e89b-42d3-a456-426614174000",
          1,
          expectedAction,
        ),
      );
    },
  );

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

    fireEvent.click(screen.getByRole("button", { name: /^Odrzuć:/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAttribute("data-management-theme", "true");
    expect(runAction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Anuluj" }));
    expect(runAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Odrzuć:/ }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: /^Odrzuć:/,
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

    fireEvent.click(screen.getByRole("button", { name: /^Zaakceptuj:/ }));

    expect(
      await screen.findByRole("button", {
        name: /^Rozpocznij występ:/,
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
        name: /^Rozpocznij występ:/,
      }),
    ).toBeInTheDocument();
  });

  it("rolls back a failed optimistic action without clearing visible queue data", async () => {
    const pending = makeItem(1, "pending");
    let finishCanonicalRefresh!: (value: {
      items: DashboardEventQueueItemDto[];
    }) => void;
    runAction.mockRejectedValue(
      new OperatorClientError(409, "QUEUE_ACTION_CONFLICT", "Conflict"),
    );
    getQueue.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCanonicalRefresh = resolve;
        }),
    );
    renderPanel([pending]);

    fireEvent.click(screen.getByRole("button", { name: /^Zaakceptuj:/ }));

    expect(screen.getByRole("button", { name: /^Rozpocznij występ:/ })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Zaakceptuj:/ })).toBeVisible(),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Zgłoszenie zostało w międzyczasie zmienione",
    );
    finishCanonicalRefresh({ items: [pending] });
  });

  it("switches to dedicated read-only state when the server closes the queue", async () => {
    const pending = makeItem(1, "pending");
    runAction.mockRejectedValue(
      new OperatorClientError(409, "EVENT_QUEUE_CLOSED", "Closed"),
    );
    getQueue.mockResolvedValue({ items: [pending] });
    renderPanel([pending]);

    fireEvent.click(screen.getByRole("button", { name: /^Zaakceptuj:/ }));

    await waitFor(() =>
      expect(document.querySelector("[data-queue-closed]")).toBeVisible(),
    );
    expect(getQueue).toHaveBeenCalledOnce();
    expect(screen.getByText("Singer 1")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Zaakceptuj:/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Odśwież" })).toBeEnabled();
  });

  it("retains queue data and reports a failed Realtime refetch", async () => {
    const pending = makeItem(1, "pending");
    getQueue.mockRejectedValue(new Error("offline"));
    renderPanel([pending]);

    await realtime.invalidate?.("broadcast", new AbortController().signal);

    expect(screen.getByText("Singer 1")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Nie udało się pobrać aktualnych danych",
      ),
    );
  });

  it("keeps the newest canonical GET when an older response finishes later", async () => {
    const pending = makeItem(1, "pending");
    const older = { ...pending, status: "approved" as const, position: 1 };
    const newer = { ...pending, status: "rejected" as const, version: 3 };
    const requestA = deferred<{ items: DashboardEventQueueItemDto[] }>();
    const requestB = deferred<{ items: DashboardEventQueueItemDto[] }>();

    getQueue
      .mockImplementationOnce(() => requestA.promise)
      .mockImplementationOnce(() => requestB.promise);
    renderPanel([pending]);

    const staleRefresh = realtime.invalidate?.(
      "broadcast",
      new AbortController().signal,
    );
    fireEvent.click(screen.getByRole("button", { name: "Odśwież" }));
    expect(getQueue).toHaveBeenCalledTimes(2);

    await act(async () => {
      requestB.resolve({ items: [newer] });
      await requestB.promise;
    });
    await waitFor(() => expect(getItemStatus(1)).toBe("rejected"));

    await act(async () => {
      requestA.resolve({ items: [older] });
      await staleRefresh;
    });

    expect(getItemStatus(1)).toBe("rejected");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores an older canonical GET error after a newer success", async () => {
    const pending = makeItem(1, "pending");
    const newer = { ...pending, status: "rejected" as const, version: 3 };
    const requestA = deferred<{ items: DashboardEventQueueItemDto[] }>();
    const requestB = deferred<{ items: DashboardEventQueueItemDto[] }>();

    getQueue
      .mockImplementationOnce(() => requestA.promise)
      .mockImplementationOnce(() => requestB.promise);
    renderPanel([pending]);

    const staleRefresh = realtime.invalidate?.(
      "broadcast",
      new AbortController().signal,
    );
    fireEvent.click(screen.getByRole("button", { name: "Odśwież" }));

    await act(async () => {
      requestB.resolve({ items: [newer] });
      await requestB.promise;
    });
    await waitFor(() => expect(getItemStatus(1)).toBe("rejected"));

    await act(async () => {
      requestA.reject(new Error("stale offline error"));
      await staleRefresh;
    });

    expect(getItemStatus(1)).toBe("rejected");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("coalesces a burst of Realtime invalidations into one queued refetch", async () => {
    const pending = makeItem(1, "pending");
    let resolveFirst!: (value: { items: DashboardEventQueueItemDto[] }) => void;
    getQueue
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({ items: [pending] });
    renderPanel([pending]);

    const first = realtime.invalidate?.(
      "broadcast",
      new AbortController().signal,
    );
    const second = realtime.invalidate?.(
      "broadcast",
      new AbortController().signal,
    );
    const third = realtime.invalidate?.(
      "broadcast",
      new AbortController().signal,
    );

    expect(getQueue).toHaveBeenCalledOnce();
    resolveFirst({ items: [pending] });
    await Promise.all([first, second, third]);
    await waitFor(() => expect(getQueue).toHaveBeenCalledTimes(2));
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

  it.each([
    ["success", "success", "rejected"],
    ["fail", "success", "rejected"],
    ["success", "fail", "approved"],
    ["fail", "fail", "pending"],
  ] as const)(
    "rebases two operations on the same request when A=%s and B=%s even if canonical refresh fails",
    async (firstOutcome, secondOutcome, expectedStatus) => {
      const pending = makeItem(1, "pending");
      const approved = {
        ...pending,
        status: "approved" as const,
        position: 1,
        version: 2,
      };
      const rejected = {
        ...pending,
        status: "rejected" as const,
        position: 0,
        version: firstOutcome === "success" ? 3 : 2,
      };
      const first = deferred<{ request: DashboardEventQueueItemDto }>();
      const second = deferred<{ request: DashboardEventQueueItemDto }>();

      runAction
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise);
      getQueue.mockRejectedValue(new Error("canonical unavailable"));
      renderPanel([pending]);

      fireEvent.click(screen.getByRole("button", { name: /^Zaakceptuj:/ }));
      fireEvent.click(
        await screen.findByRole("button", { name: /^Odrzuć:/ }),
      );
      fireEvent.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: /^Odrzuć:/,
        }),
      );

      expect(runAction).toHaveBeenCalledOnce();
      settleDeferred(first, firstOutcome, { request: approved });
      await waitFor(() => expect(runAction).toHaveBeenCalledTimes(2));
      settleDeferred(second, secondOutcome, { request: rejected });

      await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
      await waitFor(() => expect(getItemStatus(1)).toBe(expectedStatus));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Nie udało się pobrać aktualnych danych",
      );
    },
  );

  it("lets a successful canonical GET replace the locally recovered base", async () => {
    const pending = makeItem(1, "pending");
    const rejected = { ...pending, status: "rejected" as const, version: 5 };

    runAction.mockRejectedValue(
      new OperatorClientError(409, "QUEUE_ACTION_CONFLICT", "Conflict"),
    );
    getQueue.mockResolvedValue({ items: [rejected] });
    renderPanel([pending]);

    fireEvent.click(screen.getByRole("button", { name: /^Zaakceptuj:/ }));

    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    await waitFor(() => expect(getItemStatus(1)).toBe("rejected"));
  });

  it("queues Realtime invalidation behind two requests and reconciles different requests once", async () => {
    const firstPending = makeItem(1, "pending");
    const secondPending = makeItem(2, "pending");
    const firstApproved = {
      ...firstPending,
      status: "approved" as const,
      position: 1,
      version: 2,
    };
    const secondApproved = {
      ...secondPending,
      status: "approved" as const,
      position: 2,
      version: 2,
    };
    const first = deferred<{ request: DashboardEventQueueItemDto }>();
    const second = deferred<{ request: DashboardEventQueueItemDto }>();

    runAction
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    getQueue.mockResolvedValue({ items: [firstApproved, secondApproved] });
    renderPanel([firstPending, secondPending]);

    fireEvent.click(
      screen.getByRole("button", { name: "Zaakceptuj: Singer 1 — Song 1" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Zaakceptuj: Singer 2 — Song 2" }),
    );
    await realtime.invalidate?.("broadcast", new AbortController().signal);

    expect(getQueue).not.toHaveBeenCalled();
    expect(runAction).toHaveBeenCalledOnce();
    first.resolve({ request: firstApproved });
    await waitFor(() => expect(runAction).toHaveBeenCalledTimes(2));
    second.resolve({ request: secondApproved });

    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    expect(getItemStatus(1)).toBe("approved");
    expect(getItemStatus(2)).toBe("approved");
  });

  it("replays three quick operations in order without relying on canonical refresh", async () => {
    const pending = makeItem(1, "pending");
    const approved = {
      ...pending,
      status: "approved" as const,
      position: 1,
      version: 2,
    };
    const done = {
      ...approved,
      status: "done" as const,
      position: 0,
      version: 3,
    };
    const restored = {
      ...done,
      status: "pending" as const,
      version: 4,
    };
    const first = deferred<{ request: DashboardEventQueueItemDto }>();
    const second = deferred<{ request: DashboardEventQueueItemDto }>();
    const third = deferred<{ request: DashboardEventQueueItemDto }>();

    runAction
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);
    getQueue.mockRejectedValue(new Error("canonical unavailable"));
    renderPanel([pending]);

    fireEvent.click(screen.getByRole("button", { name: /^Zaakceptuj:/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Oznacz jako zagrane:/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /^Przywróć:/ }),
    );

    first.resolve({ request: approved });
    await waitFor(() => expect(runAction).toHaveBeenCalledTimes(2));
    second.resolve({ request: done });
    await waitFor(() => expect(runAction).toHaveBeenCalledTimes(3));
    third.resolve({ request: restored });

    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    await waitFor(() => expect(getItemStatus(1)).toBe("pending"));
  });

  it("keeps the confirmed base, blocks later POSTs, and reports refresh failure when the second operation closes the queue", async () => {
    const pending = makeItem(1, "pending");
    const approved = {
      ...pending,
      status: "approved" as const,
      position: 1,
      version: 2,
    };
    const first = deferred<{ request: DashboardEventQueueItemDto }>();
    const second = deferred<{ request: DashboardEventQueueItemDto }>();

    runAction
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    getQueue.mockRejectedValue(new Error("canonical unavailable"));
    renderPanel([pending]);

    fireEvent.click(screen.getByRole("button", { name: /^Zaakceptuj:/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Oznacz jako zagrane:/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /^Przywróć:/ }),
    );

    first.resolve({ request: approved });
    await waitFor(() => expect(runAction).toHaveBeenCalledTimes(2));
    second.reject(
      new OperatorClientError(409, "EVENT_QUEUE_CLOSED", "Closed"),
    );

    await waitFor(() =>
      expect(document.querySelector("[data-queue-closed]")).toBeVisible(),
    );
    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    expect(runAction).toHaveBeenCalledTimes(2);
    expect(getItemStatus(1)).toBe("approved");
    expect(
      screen.getByText(/Nie udało się odświeżyć kolejki po jej zamknięciu/),
    ).toBeVisible();
  });

  it("unlocks the same component when lifecycle changes from scheduled to active", async () => {
    const pending = makeItem(1, "pending");
    const approved = {
      ...pending,
      status: "approved" as const,
      position: 1,
      version: 2,
    };
    runAction.mockResolvedValue({ request: approved });
    getQueue.mockResolvedValue({ items: [approved] });
    const view = renderPanel([pending], true, { lifecycle: "scheduled" });

    expect(screen.queryByRole("button", { name: /^Zaakceptuj:/ })).toBeNull();
    view.rerender(makePanel([pending], true, { lifecycle: "active" }));

    fireEvent.click(
      await screen.findByRole("button", { name: /^Zaakceptuj:/ }),
    );
    await waitFor(() => expect(runAction).toHaveBeenCalledOnce());
  });

  it.each(["closed", "cancelled"] as const)(
    "does not send a queued mutation after lifecycle changes from active to %s",
    async (lifecycle) => {
      const firstPending = makeItem(1, "pending");
      const secondPending = makeItem(2, "pending");
      const firstApproved = {
        ...firstPending,
        status: "approved" as const,
        position: 1,
        version: 2,
      };
      const first = deferred<{ request: DashboardEventQueueItemDto }>();

      runAction
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce({
          request: {
            ...secondPending,
            status: "approved" as const,
            position: 2,
            version: 2,
          },
        });
      getQueue.mockResolvedValue({ items: [firstApproved, secondPending] });
      const view = renderPanel([firstPending, secondPending]);

      fireEvent.click(
        screen.getByRole("button", { name: "Zaakceptuj: Singer 1 — Song 1" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Zaakceptuj: Singer 2 — Song 2" }),
      );
      await waitFor(() => expect(runAction).toHaveBeenCalledOnce());

      view.rerender(
        makePanel([firstPending, secondPending], true, { lifecycle }),
      );
      await act(async () => {
        first.resolve({ request: firstApproved });
        await first.promise;
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(screen.queryByText("Trwa zapis…")).not.toBeInTheDocument(),
      );
      expect(runAction).toHaveBeenCalledOnce();
      expect(getItemStatus(1)).toBe("approved");
      expect(getItemStatus(2)).toBe("pending");
    },
  );

  it("aborts canonical recovery when the component unmounts", async () => {
    const pending = makeItem(1, "pending");
    let recoverySignal: AbortSignal | undefined;
    const recovery = deferred<{ items: DashboardEventQueueItemDto[] }>();

    runAction.mockRejectedValue(
      new OperatorClientError(409, "EVENT_QUEUE_CLOSED", "Closed"),
    );
    getQueue.mockImplementation(
      (_organizationId, _eventId, signal: AbortSignal) => {
        recoverySignal = signal;
        return recovery.promise;
      },
    );
    const view = renderPanel([pending]);

    fireEvent.click(screen.getByRole("button", { name: /^Zaakceptuj:/ }));
    await waitFor(() => expect(getQueue).toHaveBeenCalledOnce());
    view.unmount();

    expect(recoverySignal?.aborted).toBe(true);
    recovery.resolve({ items: [pending] });
  });

  it("does not start closed-queue recovery when a mutation rejects after unmount", async () => {
    const mutation = deferred<{ request: DashboardEventQueueItemDto }>();
    runAction.mockImplementation(() => mutation.promise);
    const view = renderPanel([makeItem(1, "pending")]);

    fireEvent.click(screen.getByRole("button", { name: /^Zaakceptuj:/ }));
    await waitFor(() => expect(runAction).toHaveBeenCalledOnce());
    view.unmount();

    await act(async () => {
      mutation.reject(
        new OperatorClientError(409, "EVENT_QUEUE_CLOSED", "Closed"),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getQueue).not.toHaveBeenCalled();
  });

  it("blocks a third queued POST when EVENT_QUEUE_CLOSED arrives after unmount", async () => {
    const pending = makeItem(1, "pending");
    const approved = {
      ...pending,
      status: "approved" as const,
      position: 1,
      version: 2,
    };
    const first = deferred<{ request: DashboardEventQueueItemDto }>();
    const second = deferred<{ request: DashboardEventQueueItemDto }>();
    const third = deferred<{ request: DashboardEventQueueItemDto }>();

    runAction
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);
    const view = renderPanel([pending]);

    fireEvent.click(screen.getByRole("button", { name: /^Zaakceptuj:/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Oznacz jako zagrane:/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /^Przywróć:/ }),
    );

    await act(async () => {
      first.resolve({ request: approved });
      await first.promise;
    });
    await waitFor(() => expect(runAction).toHaveBeenCalledTimes(2));
    view.unmount();

    await act(async () => {
      second.reject(
        new OperatorClientError(409, "EVENT_QUEUE_CLOSED", "Closed"),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runAction).toHaveBeenCalledTimes(2);
    expect(getQueue).not.toHaveBeenCalled();
  });
});

function renderPanel(
  initialItems: DashboardEventQueueItemDto[],
  canManage = true,
  options: {
    lifecycle?: DashboardEventLifecycleStatus;
    publicQueueEnabled?: boolean;
  } = {},
) {
  return render(makePanel(initialItems, canManage, options));
}

function makePanel(
  initialItems: DashboardEventQueueItemDto[],
  canManage = true,
  options: {
    lifecycle?: DashboardEventLifecycleStatus;
    publicQueueEnabled?: boolean;
  } = {},
) {
  return (
    <EventQueuePanel
      organizationId="organization-test"
      eventId="123e4567-e89b-42d3-a456-426614174000"
      realtimeEventId={1}
      canManage={canManage}
      lifecycle={options.lifecycle ?? "active"}
      publicQueueEnabled={options.publicQueueEnabled ?? true}
      initialItems={initialItems}
    />
  );
}

function getItemStatus(requestId: number) {
  return document
    .querySelector(`[data-queue-request-id="${requestId}"] [data-request-status]`)
    ?.getAttribute("data-request-status");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function settleDeferred<T>(
  target: ReturnType<typeof deferred<T>>,
  outcome: "success" | "fail",
  value: T,
) {
  if (outcome === "success") {
    target.resolve(value);
  } else {
    target.reject(
      new OperatorClientError(409, "QUEUE_ACTION_CONFLICT", "Conflict"),
    );
  }
}

type KeyboardTestLane = "pending" | "approved" | "rejected";
type KeyboardTestRect = ReturnType<typeof queueRect>;
type KeyboardTestContainer = {
  id: string;
  data: {
    current:
      | { type: "request"; requestId: number; lane: KeyboardTestLane }
      | { type: "lane"; lane: KeyboardTestLane };
  };
  disabled: boolean;
  rect: KeyboardTestRect;
};

function queueRect(
  left: number,
  top: number,
  width = 100,
  height = 40,
) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

function keyboardRequestContainer(
  requestId: number,
  lane: KeyboardTestLane,
  rect: KeyboardTestRect,
): KeyboardTestContainer {
  return {
    id: `queue-request:${requestId}`,
    data: { current: { type: "request", requestId, lane } },
    disabled: false,
    rect,
  };
}

function keyboardLaneContainer(
  lane: KeyboardTestLane,
  rect: KeyboardTestRect,
): KeyboardTestContainer {
  return {
    id: `queue-lane:${lane}`,
    data: { current: { type: "lane", lane } },
    disabled: false,
    rect,
  };
}

function runKeyboardCoordinates(
  code: string,
  overRequestId: number,
  lane: KeyboardTestLane,
  containers: KeyboardTestContainer[],
) {
  const active = containers.find(
    (container) =>
      container.data.current.type === "request" &&
      container.data.current.requestId === 1,
  );
  const over = containers.find(
    (container) => container.id === `queue-request:${overRequestId}`,
  );

  if (!active || !over || !dnd.keyboardCoordinates) {
    throw new Error("Keyboard DnD test context is incomplete.");
  }

  return dnd.keyboardCoordinates(
    new KeyboardEvent("keydown", { code }),
    {
      context: {
        active: {
          id: active.id,
          data: {
            current: { type: "request", requestId: 1, lane },
          },
        },
        collisionRect: over.rect,
        droppableContainers: {
          getEnabled: () => containers,
        },
        droppableRects: new Map(
          containers.map((container) => [container.id, container.rect]),
        ),
        over: {
          id: over.id,
          data: over.data,
        },
      },
    } as unknown as Parameters<KeyboardCoordinateGetter>[1],
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
