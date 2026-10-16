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
  dnd,
  getQueue,
  moveRequest,
  placeRequest,
  realtime,
  runAction,
  fairPreview,
  fairApply,
  toastInfo,
  toastSuccess,
} = vi.hoisted(() => ({
    dnd: {
      collisionDetection: null as CollisionDetection | null,
      contextId: null as string | null,
      dragEnd: null as ((event: DragEndEvent) => void) | null,
      dragStart: null as ((event: DragStartEvent) => void) | null,
      keyboardCoordinates: null as KeyboardCoordinateGetter | null,
    },
    getQueue: vi.fn(),
    moveRequest: vi.fn(),
    placeRequest: vi.fn(),
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
    fairPreview: vi.fn(),
    fairApply: vi.fn(),
    toastInfo: vi.fn(),
    toastSuccess: vi.fn(),
  }));

vi.mock("@dnd-kit/core", () => ({
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
  MouseSensor: class MouseSensor {},
  TouchSensor: class TouchSensor {},
  MeasuringStrategy: { Always: 0 },
  useDraggable: () => ({ attributes: {}, isDragging: false, listeners: {}, setActivatorNodeRef: vi.fn(), setNodeRef: vi.fn() }),
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

vi.mock("sonner", () => ({
  toast: { info: toastInfo, success: toastSuccess },
}));

vi.mock("@/components/operator/event-queue-api", () => ({
  getDashboardEventQueue: getQueue,
  moveDashboardEventQueueRequest: moveRequest,
  placeDashboardEventQueueRequest: placeRequest,
  runDashboardEventQueueAction: runAction,
  previewDashboardFairQueue: fairPreview,
  applyDashboardFairQueue: fairApply,
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
    dnd.collisionDetection = null;
    dnd.contextId = null;
    dnd.keyboardCoordinates = null;
    getQueue.mockReset();
    dnd.dragEnd = null;
    dnd.dragStart = null;
    moveRequest.mockReset();
    placeRequest.mockReset();
    realtime.invalidate = null;
    realtime.status = "live";
    runAction.mockReset();
    fairPreview.mockReset(); fairApply.mockReset();
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

  it("uses the entire canonical approval response when Fair Insert shifts other rows", async () => {
    const pending = makeItem(1, "pending"), existing = { ...makeItem(2, "approved"), position: 1 };
    const accepted = { ...pending, status: "approved" as const, position: 1, version: 2 };
    const shifted = { ...existing, position: 2, version: 2 };
    getQueue.mockResolvedValue({ items: [accepted, shifted] });
    runAction.mockResolvedValue({ request: accepted, items: [accepted, shifted] });
    renderPanel([pending, existing]);
    fireEvent.click(screen.getByRole("button", { name: /^Zaakceptuj:/ }));
    await waitFor(() => expect(document.querySelectorAll('[data-queue-lane="approved"] [data-queue-request-id] strong')[0]).toHaveTextContent("Singer 1"));
    expect(document.querySelectorAll('[data-queue-lane="approved"] [data-queue-request-id] strong')[1]).toHaveTextContent("Singer 2");
  });

  it("prevents a delayed refresh from overwriting an applied fair-sort snapshot", async () => {
    const first = { ...makeItem(1, "approved"), position: 1 }, second = { ...makeItem(2, "approved"), position: 2 };
    let release!: (result: { items: DashboardEventQueueItemDto[] }) => void;
    getQueue.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const canonical = [{ ...second, position: 1, version: 2 }, { ...first, position: 2, version: 2 }];
    getQueue.mockResolvedValue({ items: canonical });
    fairPreview.mockResolvedValue({ revision: "a".repeat(64), changes: [
      { id: 2, from: 2, to: 1, displayName: "Singer 2", songTitle: "Song 2" },
      { id: 1, from: 1, to: 2, displayName: "Singer 1", songTitle: "Song 1" },
    ] });
    fairApply.mockResolvedValue({ changed: 2, items: canonical });
    renderPanel([first, second]);
    await act(async () => { void realtime.invalidate?.("queue", new AbortController().signal); });
    fireEvent.click(screen.getByRole("button", { name: "Ułóż sprawiedliwie" }));
    fireEvent.click(await screen.findByRole("button", { name: "Zastosuj kolejność" }));
    await waitFor(() => expect(fairApply).toHaveBeenCalledOnce());
    await act(async () => release({ items: [first, second] }));
    await waitFor(() => expect(document.querySelectorAll('[data-queue-lane="approved"] [data-queue-request-id] strong')[0]).toHaveTextContent("Singer 2"));
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

  it("rolls back an atomic drop after a stale conflict and restores focus", async () => {
    const pending = makeItem(1, "pending");
    const mutation = deferred<{ request: DashboardEventQueueItemDto; items: DashboardEventQueueItemDto[] }>();
    placeRequest.mockReturnValue(mutation.promise);
    getQueue.mockResolvedValue({ items: [pending] }); renderPanel([pending]);
    dragTo(1, "pending", "approved");
    await waitFor(() => expect(placeRequest).toHaveBeenCalledOnce());
    expect(within(document.querySelector('[data-queue-lane="approved"]')!).getByText("Singer 1")).toBeVisible();
    await act(async () => { mutation.reject(new OperatorClientError(409, "QUEUE_PLACEMENT_STALE", "Conflict")); });
    await waitFor(() => expect(within(document.querySelector('[data-queue-lane="pending"]')!).getByText("Singer 1")).toBeVisible());
    await waitFor(() => expect(screen.getByRole("article", { name: "Zgłoszenie: Singer 1 — Song 1" })).toHaveFocus());
    expect(screen.getByText(/Kolejka została zmieniona przez innego operatora/)).toBeVisible();
  });

  it("preserves source geometry, responsive board and unique request IDs", () => {
    renderPanel([makeItem(1, "rejected")]);
    expect(document.querySelector("[data-queue-board]")).toHaveClass("grid-cols-1", "@min-[48rem]/queue:grid-cols-2");
    expect(document.querySelector('[data-queue-lane="rejected"]')).toHaveClass("col-span-full");
    startDrag(1, "rejected");
    expect(document.querySelector("[data-queue-drag-overlay]")).toHaveClass("h-full", "w-full", "[&>article]:h-full");
    expect(document.querySelectorAll('[data-queue-request-id="1"]')).toHaveLength(1);
  });

  it("does not mutate outside slots or for invalid same-lane status drops", async () => {
    renderPanel([makeItem(1, "rejected")]); dragTo(1, "rejected", "rejected", 1, false);
    await act(async () => { await Promise.resolve(); }); expect(placeRequest).not.toHaveBeenCalled();
    act(() => dnd.dragEnd?.({ active: { data: { current: { type: "request", requestId: 1, lane: "rejected" } } }, over: null } as unknown as DragEndEvent));
    expect(placeRequest).not.toHaveBeenCalled();
  });

  it("requires cancel-first confirmation for a dragged rejection, then one confirmed placement", async () => {
    const source = makeItem(1, "approved"), rejected = { ...source, status: "rejected" as const, version: 2, position: 0 };
    getQueue.mockResolvedValue({ items: [rejected] }); placeRequest.mockResolvedValue({ request: rejected, items: [rejected] }); renderPanel([source]);
    dragTo(1, "approved", "rejected"); expect(screen.getByRole("alertdialog")).toBeVisible(); expect(placeRequest).not.toHaveBeenCalled();
    await act(async () => { await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve())); });
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" })); expect(placeRequest).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("article", { name: "Zgłoszenie: Singer 1 — Song 1" })).toHaveFocus());
    dragTo(1, "approved", "rejected"); fireEvent.click(screen.getByRole("button", { name: "Odrzuć zgłoszenie" }));
    await waitFor(() => expect(placeRequest).toHaveBeenCalledExactlyOnceWith("organization-test", "123e4567-e89b-42d3-a456-426614174000", 1, expect.objectContaining({ lane: "rejected", confirmed: true })));
    expect(runAction).not.toHaveBeenCalled(); expect(moveRequest).not.toHaveBeenCalled();
  });

  it.each([["pending", "approved"], ["rejected", "pending"], ["rejected", "approved"]] as const)("atomically places %s into empty %s", async (sourceLane, lane) => {
    const source = makeItem(1, sourceLane), target = { ...source, status: lane, position: lane === "approved" ? 1 : 0, version: 2 };
    placeRequest.mockResolvedValue({ request: target, items: [target] }); getQueue.mockResolvedValue({ items: [target] }); renderPanel([source]);
    dragTo(1, sourceLane, lane); await waitFor(() => expect(placeRequest).toHaveBeenCalledOnce());
    expect(within(document.querySelector(`[data-queue-lane="${lane}"]`)!).getByText("Singer 1")).toBeVisible();
    expect(runAction).not.toHaveBeenCalled(); expect(moveRequest).not.toHaveBeenCalled();
  });

  it("returns full canonical positions with one placement call, without separate action and move", async () => {
    const source = makeItem(1, "pending"), other = makeItem(2, "approved"), moved = { ...source, status: "approved" as const, position: 1, version: 2 };
    const canonical = [moved, { ...other, position: 2, version: 2 }];
    placeRequest.mockResolvedValue({ request: moved, items: canonical }); getQueue.mockResolvedValue({ items: canonical }); renderPanel([source, other]);
    dragTo(1, "pending", "approved"); await waitFor(() => expect(placeRequest).toHaveBeenCalledOnce());
    expect(runAction).not.toHaveBeenCalled(); expect(moveRequest).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelectorAll('[data-queue-lane="approved"] [data-queue-request-id]')).toHaveLength(2));
    expect(within(document.querySelector('[data-queue-request-id="2"]')!).getByText("Pozycja: 2")).toBeVisible();
  });

  it("aborts an active gesture on Realtime and refreshes without mutation", async () => {
    const source = makeItem(1, "approved"); getQueue.mockResolvedValue({ items: [{ ...source, version: 2 }] }); renderPanel([source]);
    startDrag(1, "approved"); expect(document.querySelector("[data-queue-drag-overlay]")).toBeInTheDocument();
    const obsoleteEnd = dnd.dragEnd;
    await act(async () => { await realtime.invalidate?.("queue", new AbortController().signal); });
    expect(document.querySelector("[data-queue-drag-overlay]")).not.toBeInTheDocument();
    expect(screen.getByText(/Kolejka została zaktualizowana/)).toBeVisible(); expect(placeRequest).not.toHaveBeenCalled();
    act(() => obsoleteEnd?.({ active: { data: { current: { type: "request", requestId: 1, lane: "approved" } } },
      over: { data: { current: { type: "slot", lane: "rejected", position: 1, allowed: true } } } } as unknown as DragEndEvent));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(placeRequest).not.toHaveBeenCalled();
  });

  it("keeps an active gesture when a reconnect refetch has the same canonical revision", async () => {
    const source = makeItem(1, "approved"); getQueue.mockResolvedValue({ items: [source] }); renderPanel([source]);
    startDrag(1, "approved");
    await act(async () => { await realtime.invalidate?.("reconnect", new AbortController().signal); });
    expect(document.querySelector("[data-queue-drag-overlay]")).toBeInTheDocument();
    expect(placeRequest).not.toHaveBeenCalled();
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

    await realtime.invalidate?.("queue", new AbortController().signal);
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

  it("rolls back restore and refreshes canonical state after a participant limit rejection", async () => {
    const skipped = makeItem(1, "skipped");
    runAction.mockRejectedValue(new OperatorClientError(409, "SESSION_REQUEST_LIMIT_REACHED", "Safe limit"));
    getQueue.mockResolvedValue({ items: [skipped] });
    renderPanel([skipped]);
    fireEvent.click(screen.getByRole("button", { name: "Przywróć: Singer 1 — Song 1" }));
    await waitFor(() => expect(getQueue).toHaveBeenCalled());
    await waitFor(() => expect(getItemStatus(1)).toBe("skipped"));
    expect(screen.getByRole("alert")).toHaveTextContent("Ta osoba ma już 2 aktywne zgłoszenia");
    await act(async () => {
      await realtime.invalidate?.("queue", new AbortController().signal);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Ta osoba ma już 2 aktywne zgłoszenia");
    expect(toastSuccess).not.toHaveBeenCalledWith("Kolejka zaktualizowana");
  });

  it("refreshes the canonical queue after an active duplicate blocks restore", async () => {
    const skipped = makeItem(1, "skipped");
    const activeDuplicate = makeItem(2, "pending");
    runAction.mockRejectedValue(
      new OperatorClientError(
        409,
        "QUEUE_ACTIVE_DUPLICATE",
        "Active duplicate",
      ),
    );
    getQueue.mockResolvedValue({ items: [skipped, activeDuplicate] });
    renderPanel([skipped]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Przywróć: Singer 1 — Song 1",
      }),
    );

    await waitFor(() => expect(getQueue).toHaveBeenCalled());
    await waitFor(() => expect(getItemStatus(1)).toBe("skipped"));
    expect(screen.getByText("Singer 2")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ta osoba ma już aktywne zgłoszenie tej piosenki",
    );
    expect(toastSuccess).not.toHaveBeenCalledWith("Kolejka zaktualizowana");
  });

  it("reports when the canonical refresh after an active duplicate fails", async () => {
    const skipped = makeItem(1, "skipped");
    runAction.mockRejectedValue(
      new OperatorClientError(
        409,
        "QUEUE_ACTIVE_DUPLICATE",
        "Active duplicate",
      ),
    );
    getQueue.mockRejectedValue(new Error("offline"));
    renderPanel([skipped]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Przywróć: Singer 1 — Song 1",
      }),
    );

    await waitFor(() => expect(getQueue).toHaveBeenCalled());
    await waitFor(() => expect(getItemStatus(1)).toBe("skipped"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Nie udało się odświeżyć kolejki. Odśwież ją ręcznie.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "Kolejka została odświeżona",
    );
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

    await realtime.invalidate?.("queue", new AbortController().signal);

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
      "queue",
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
      "queue",
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
      "queue",
      new AbortController().signal,
    );
    const second = realtime.invalidate?.(
      "queue",
      new AbortController().signal,
    );
    const third = realtime.invalidate?.(
      "queue",
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
    await realtime.invalidate?.("queue", new AbortController().signal);

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

function startDrag(requestId: number, lane: "pending" | "approved" | "rejected") {
  act(() => dnd.dragStart?.({ active: { data: { current: { type: "request", requestId, lane } } } } as unknown as DragStartEvent));
}
function dragTo(requestId: number, source: "pending" | "approved" | "rejected", lane: "pending" | "approved" | "rejected", position = 1, allowed = true) {
  startDrag(requestId, source);
  act(() => dnd.dragEnd?.({ active: { data: { current: { type: "request", requestId, lane: source } } }, over: { data: { current: { type: "slot", lane, position, allowed } } } } as unknown as DragEndEvent));
}
