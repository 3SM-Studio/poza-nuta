"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleCheck,
  GripVertical,
  Mic2,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { RequestStatusBadge } from "@/components/request-status-badge";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  canApplyDashboardEventQueueAction,
  type DashboardEventQueueAction,
  type DashboardEventQueueMoveDirection,
  type DashboardEventQueueRequestStatus,
} from "@/lib/dashboard-event-queue";
import {
  applyOptimisticDashboardEventQueueAction,
  applyOptimisticDashboardEventQueueMove,
  applyOptimisticDashboardEventQueueMoveToPosition,
  getDashboardEventQueueChangedRequestIds,
  reconcileDashboardEventQueueItem,
  restoreDashboardEventQueueItems,
} from "@/lib/dashboard-event-queue-optimistic";
import type {
  QueueRealtimeConnectionStatus,
  QueueRealtimeInvalidateReason,
} from "@/lib/queue-realtime";
import { formatWarsawDateTime } from "@/lib/warsaw-time";

import { formatDuration, OperatorClientError } from "./api";
import {
  getDashboardEventQueue,
  moveDashboardEventQueueRequest,
  runDashboardEventQueueAction,
  type DashboardEventQueueItemDto,
} from "./event-queue-api";
import { useDashboardQueueRealtime } from "./use-dashboard-queue-realtime";

const actionLabels: Record<DashboardEventQueueAction, string> = {
  approve: "Zaakceptuj",
  start: "Ustaw jako aktualnie śpiewane",
  reject: "Odrzuć",
  done: "Oznacz jako zagrane",
  restore: "Przywróć",
};

type EventQueuePanelProps = {
  organizationId: string;
  eventId: string;
  realtimeEventId: number;
  canManage: boolean;
  initialItems: DashboardEventQueueItemDto[];
};

type QueueRefreshReason = QueueRealtimeInvalidateReason | "local";
type QueueBoardLane = "pending" | "approved" | "rejected";

const queueBoardLanes: QueueBoardLane[] = [
  "pending",
  "approved",
  "rejected",
];

const queueBoardLaneLabels: Record<QueueBoardLane, string> = {
  pending: "Oczekujące",
  approved: "Zaakceptowane",
  rejected: "Odrzucone",
};

const queueCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);

  return pointerCollisions.length > 0
    ? pointerCollisions
    : closestCorners(args);
};

export function EventQueuePanel({
  organizationId,
  eventId,
  realtimeEventId,
  canManage,
  initialItems,
}: EventQueuePanelProps) {
  const [items, setItems] = useState(initialItems);
  const [activeDragRequestId, setActiveDragRequestId] = useState<number | null>(
    null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingMutationCountRef = useRef(0);
  const localMutationVersionRef = useRef(0);
  const realtimeRefreshInFlightRef = useRef(false);
  const realtimeRefreshQueuedRef = useRef(false);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const refreshFromRealtimeRef = useRef<
    | ((
        reason: QueueRefreshReason,
        signal: AbortSignal,
      ) => Promise<void>)
    | null
  >(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const currentItem = useMemo(
    () => items.find((item) => item.status === "now") ?? null,
    [items],
  );
  const approvedItems = useMemo(
    () =>
      items
        .filter((item) => item.status === "approved")
        .sort(
          (left, right) =>
            left.position - right.position || left.id - right.id,
        ),
    [items],
  );
  const boardItems = useMemo(
    () =>
      Object.fromEntries(
        queueBoardLanes.map((lane) => [
          lane,
          items.filter((item) => item.status === lane),
        ]),
      ) as Record<QueueBoardLane, DashboardEventQueueItemDto[]>,
    [items],
  );
  const closedItems = useMemo(
    () =>
      items.filter(
        (item) => item.status === "done" || item.status === "skipped",
      ),
    [items],
  );
  const activeDragItem = useMemo(
    () => items.find((item) => item.id === activeDragRequestId) ?? null,
    [activeDragRequestId, items],
  );
  const flushQueuedRealtimeRefresh = useCallback(() => {
    if (
      pendingMutationCountRef.current > 0 ||
      realtimeRefreshInFlightRef.current ||
      !realtimeRefreshQueuedRef.current
    ) {
      return;
    }

    realtimeRefreshQueuedRef.current = false;
    void refreshFromRealtimeRef.current?.(
      "local",
      new AbortController().signal,
    );
  }, []);
  const refreshFromRealtime = useCallback(
    async (
      reason: QueueRefreshReason,
      signal: AbortSignal,
    ) => {
      if (
        pendingMutationCountRef.current > 0 ||
        realtimeRefreshInFlightRef.current
      ) {
        realtimeRefreshQueuedRef.current = true;
        return;
      }

      const mutationVersionAtStart = localMutationVersionRef.current;
      const showSyncIndicator = reason !== "subscribe" && reason !== "local";
      realtimeRefreshInFlightRef.current = true;

      if (showSyncIndicator) {
        setIsSyncing(true);
      }

      try {
        const response = await getDashboardEventQueue(
          organizationId,
          eventId,
          signal,
        );

        if (
          pendingMutationCountRef.current > 0 ||
          localMutationVersionRef.current !== mutationVersionAtStart
        ) {
          realtimeRefreshQueuedRef.current = true;
          return;
        }

        setItems(response.items);
        setError(null);
      } catch (caughtError) {
        if (signal.aborted || isAbortError(caughtError)) {
          return;
        }

        if (
          pendingMutationCountRef.current > 0 ||
          localMutationVersionRef.current !== mutationVersionAtStart
        ) {
          realtimeRefreshQueuedRef.current = true;
          return;
        }

        if (
          caughtError instanceof OperatorClientError &&
          caughtError.status === 401
        ) {
          window.location.replace("/sign-in");
          return;
        }

        setError(getClientErrorMessage(caughtError));
      } finally {
        realtimeRefreshInFlightRef.current = false;

        if (showSyncIndicator) {
          setIsSyncing(false);
        }

        flushQueuedRealtimeRefresh();
      }
    },
    [eventId, flushQueuedRealtimeRefresh, organizationId],
  );
  useEffect(() => {
    refreshFromRealtimeRef.current = refreshFromRealtime;

    return () => {
      refreshFromRealtimeRef.current = null;
    };
  }, [refreshFromRealtime]);
  const liveStatus = useDashboardQueueRealtime(
    realtimeEventId,
    refreshFromRealtime,
  );

  async function refreshQueue() {
    const mutationVersionAtStart = localMutationVersionRef.current;

    setIsRefreshing(true);
    setError(null);

    try {
      const response = await getDashboardEventQueue(organizationId, eventId);

      if (
        pendingMutationCountRef.current > 0 ||
        localMutationVersionRef.current !== mutationVersionAtStart
      ) {
        realtimeRefreshQueuedRef.current = true;
        return;
      }

      setItems(response.items);
      toast.success("Kolejka zaktualizowana");
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        setError(getClientErrorMessage(caughtError));
      }
    } finally {
      setIsRefreshing(false);
      flushQueuedRealtimeRefresh();
    }
  }

  function handleAction(
    requestId: number,
    action: DashboardEventQueueAction,
  ) {
    const mutationVersion = beginLocalMutation();
    let rollbackItems: DashboardEventQueueItemDto[] = [];

    setItems((currentItems) => {
      const optimisticItems = applyOptimisticDashboardEventQueueAction(
        currentItems,
        requestId,
        action,
      );
      const changedRequestIds = getDashboardEventQueueChangedRequestIds(
        currentItems,
        optimisticItems,
      );

      rollbackItems = currentItems.filter((item) =>
        changedRequestIds.includes(item.id),
      );
      return optimisticItems;
    });
    setError(null);

    scheduleMutation(async () => {
      try {
        const result = await runDashboardEventQueueAction(
          organizationId,
          eventId,
          requestId,
          action,
        );

        if (mutationVersion === localMutationVersionRef.current) {
          setItems((currentItems) =>
            reconcileDashboardEventQueueItem(currentItems, result.request),
          );
        }
      } catch (caughtError) {
        if (!handleAuthenticationError(caughtError)) {
          if (mutationVersion === localMutationVersionRef.current) {
            setItems((currentItems) =>
              restoreDashboardEventQueueItems(currentItems, rollbackItems),
            );
          }
          setError(getClientErrorMessage(caughtError));
        }
      }
    });
  }

  function handleMove(
    requestId: number,
    direction: DashboardEventQueueMoveDirection,
  ) {
    const mutationVersion = beginLocalMutation();
    let rollbackItems: DashboardEventQueueItemDto[] = [];

    setItems((currentItems) => {
      const optimisticItems = applyOptimisticDashboardEventQueueMove(
        currentItems,
        requestId,
        direction,
      );
      const changedRequestIds = getDashboardEventQueueChangedRequestIds(
        currentItems,
        optimisticItems,
      );

      rollbackItems = currentItems.filter((item) =>
        changedRequestIds.includes(item.id),
      );
      return optimisticItems;
    });
    setError(null);

    scheduleMutation(async () => {
      try {
        const result = await moveDashboardEventQueueRequest(
          organizationId,
          eventId,
          requestId,
          direction,
        );

        if (
          !result.moved &&
          mutationVersion === localMutationVersionRef.current
        ) {
          setItems((currentItems) =>
            restoreDashboardEventQueueItems(currentItems, rollbackItems),
          );
        }
      } catch (caughtError) {
        if (!handleAuthenticationError(caughtError)) {
          if (mutationVersion === localMutationVersionRef.current) {
            setItems((currentItems) =>
              restoreDashboardEventQueueItems(currentItems, rollbackItems),
            );
          }
          setError(getClientErrorMessage(caughtError));
        }
      }
    });
  }

  function handleMoveToPosition(requestId: number, targetPosition: number) {
    const mutationVersion = beginLocalMutation();
    let rollbackItems: DashboardEventQueueItemDto[] = [];

    setItems((currentItems) => {
      const optimisticItems =
        applyOptimisticDashboardEventQueueMoveToPosition(
          currentItems,
          requestId,
          targetPosition,
        );
      const changedRequestIds = getDashboardEventQueueChangedRequestIds(
        currentItems,
        optimisticItems,
      );

      rollbackItems = currentItems.filter((item) =>
        changedRequestIds.includes(item.id),
      );
      return optimisticItems;
    });
    setError(null);

    scheduleMutation(async () => {
      try {
        const result = await moveDashboardEventQueueRequest(
          organizationId,
          eventId,
          requestId,
          { targetPosition },
        );

        if (
          !result.moved &&
          mutationVersion === localMutationVersionRef.current
        ) {
          setItems((currentItems) =>
            restoreDashboardEventQueueItems(currentItems, rollbackItems),
          );
        }
      } catch (caughtError) {
        if (!handleAuthenticationError(caughtError)) {
          if (mutationVersion === localMutationVersionRef.current) {
            setItems((currentItems) =>
              restoreDashboardEventQueueItems(currentItems, rollbackItems),
            );
          }
          setError(getClientErrorMessage(caughtError));
        }
      }
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const dragData = event.active.data.current as
      | QueueRequestDragData
      | undefined;

    if (dragData?.type === "request") {
      setActiveDragRequestId(dragData.requestId);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragRequestId(null);

    if (!canManage || !event.over) {
      return;
    }

    const dragData = event.active.data.current as
      | QueueRequestDragData
      | undefined;
    const dropData = event.over.data.current as QueueDropData | undefined;

    if (dragData?.type !== "request" || !dropData) {
      return;
    }

    const targetLane = dropData.lane;
    const sourceLane = dragData.lane;
    const targetPosition = getApprovedDropPosition(
      dropData,
      approvedItems,
    );

    if (sourceLane === targetLane) {
      if (
        dropData.type === "request" &&
        dropData.requestId === dragData.requestId
      ) {
        return;
      }

      if (targetLane === "approved" && targetPosition !== null) {
        handleMoveToPosition(dragData.requestId, targetPosition);
      }
      return;
    }

    const action = getLaneTransitionAction(sourceLane, targetLane);

    if (!action) {
      return;
    }

    handleAction(dragData.requestId, action);

    if (targetLane === "approved" && targetPosition !== null) {
      handleMoveToPosition(dragData.requestId, targetPosition);
    }
  }

  function beginLocalMutation() {
    pendingMutationCountRef.current += 1;
    localMutationVersionRef.current += 1;
    realtimeRefreshQueuedRef.current = true;
    return localMutationVersionRef.current;
  }

  function scheduleMutation(task: () => Promise<void>) {
    const queuedTask = mutationQueueRef.current.then(task, task);

    mutationQueueRef.current = queuedTask.then(
      () => finishLocalMutation(),
      () => finishLocalMutation(),
    );
  }

  function finishLocalMutation() {
    pendingMutationCountRef.current = Math.max(
      0,
      pendingMutationCountRef.current - 1,
    );
    flushQueuedRealtimeRefresh();
  }

  function handleAuthenticationError(caughtError: unknown) {
    if (
      caughtError instanceof OperatorClientError &&
      caughtError.status === 401
    ) {
      window.location.replace("/sign-in");
      return true;
    }

    return false;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Zgłoszenia</CardTitle>
        <CardDescription>
          Zmiany pojawiają się od razu, a zapis odbywa się w tle.
        </CardDescription>
        <CardAction>
          <div className={"flex flex-wrap items-center justify-end gap-2"}>
            <Badge variant={liveStatus === "live" ? "default" : "secondary"}>
              {formatLiveStatus(liveStatus)}
            </Badge>
            {isSyncing ? (
              <Badge variant="secondary">Synchronizuję...</Badge>
            ) : null}
            <Button
              variant="outline"
              type="button"
              onClick={() => void refreshQueue()}
              disabled={isRefreshing}
            >
              <RefreshCw aria-hidden="true" data-icon="inline-start" />
              {isRefreshing ? "Synchronizuję..." : "Odśwież"}
            </Button>
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className={"grid gap-4"}>
        {!canManage ? (
          <Alert>
            <AlertTitle>Tryb tylko do odczytu</AlertTitle>
            <AlertDescription>
              Rola viewer pozwala przeglądać kolejkę, ale nie zmieniać statusów
              zgłoszeń ani ich kolejności.
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Nie udało się zapisać zmiany</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section className={"grid gap-3 border-y border-border py-4 [&_h3]:text-base [&_h3]:font-semibold"}>
          <div>
            <h3>Aktualnie śpiewane</h3>
            <p className={"mt-1.5 text-sm text-muted-foreground"}>
              Tylko jedno zgłoszenie może mieć ten status w wydarzeniu.
            </p>
          </div>
          {currentItem ? (
            <EventQueueRequestRow
              item={currentItem}
              canManage={canManage}
              canMoveUp={false}
              canMoveDown={false}
              onAction={handleAction}
              onMove={handleMove}
            />
          ) : (
            <CardDescription>
              Żadne zgłoszenie nie jest teraz oznaczone jako śpiewane.
            </CardDescription>
          )}
        </section>

        <DndContext
          id={`event-queue:${organizationId}:${eventId}`}
          sensors={sensors}
          collisionDetection={queueCollisionDetection}
          onDragStart={handleDragStart}
          onDragCancel={() => setActiveDragRequestId(null)}
          onDragEnd={handleDragEnd}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "Aby podnieść zgłoszenie, naciśnij spację. Strzałkami wybierz miejsce i ponownie naciśnij spację, aby je upuścić.",
            },
          }}
        >
          <div
            data-queue-board
            className={"grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3"}
          >
            {queueBoardLanes.map((lane) => (
              <QueueLane
                key={lane}
                lane={lane}
                items={boardItems[lane]}
                approvedItems={approvedItems}
                canManage={canManage}
                onAction={handleAction}
                onMove={handleMove}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeDragItem ? (
              <div
                data-queue-drag-overlay
                className={"h-full w-full opacity-95 shadow-2xl [&>article]:h-full"}
              >
                <EventQueueRequestRow
                  item={activeDragItem}
                  canManage={false}
                  canMoveUp={false}
                  canMoveDown={false}
                  onAction={handleAction}
                  onMove={handleMove}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {closedItems.length > 0 ? (
          <section className={"grid gap-3 border-t border-border pt-4"}>
            <div>
              <h3 className={"text-base font-semibold"}>Zagrane / zamknięte</h3>
              <p className={"mt-1 text-sm text-muted-foreground"}>
                Historia zakończonych i pominiętych zgłoszeń.
              </p>
            </div>
            <div className={"grid gap-3 lg:grid-cols-2"}>
              {closedItems.map((item) => (
                <EventQueueRequestRow
                  key={item.id}
                  item={item}
                  canManage={canManage}
                  canMoveUp={false}
                  canMoveDown={false}
                  onAction={handleAction}
                  onMove={handleMove}
                />
              ))}
            </div>
          </section>
        ) : null}

        {items.length === 0 ? (
          <CardDescription className={"px-4 py-16 text-center text-muted-foreground"}>
            <strong>Brak zgłoszeń</strong>
            <br />
            Nie ma jeszcze zgłoszeń z linku sesji.
          </CardDescription>
        ) : null}
      </CardContent>
    </Card>
  );
}

type QueueRequestDragData = {
  type: "request";
  requestId: number;
  lane: QueueBoardLane;
};

type QueueLaneDropData = {
  type: "lane";
  lane: QueueBoardLane;
};

type QueueDropData = QueueRequestDragData | QueueLaneDropData;

type QueueLaneProps = {
  lane: QueueBoardLane;
  items: DashboardEventQueueItemDto[];
  approvedItems: DashboardEventQueueItemDto[];
  canManage: boolean;
  onAction: (requestId: number, action: DashboardEventQueueAction) => void;
  onMove: (
    requestId: number,
    direction: DashboardEventQueueMoveDirection,
  ) => void;
};

function QueueLane({
  lane,
  items,
  approvedItems,
  canManage,
  onAction,
  onMove,
}: QueueLaneProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: getQueueLaneId(lane),
    data: { type: "lane", lane } satisfies QueueLaneDropData,
    disabled: !canManage,
  });

  return (
    <section
      ref={setNodeRef}
      data-queue-lane={lane}
      className={[
        "grid min-h-52 content-start gap-3 rounded-xl border border-border bg-muted/25 p-3 transition-colors",
        lane === "rejected" ? "lg:col-span-2 2xl:col-span-1" : "",
        isOver ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "",
      ].join(" ")}
    >
      <header className={"flex items-center justify-between gap-3 px-1"}>
        <div>
          <h3 className={"font-semibold"}>{queueBoardLaneLabels[lane]}</h3>
          <p className={"mt-0.5 text-xs text-muted-foreground"}>
            {getQueueLaneDescription(lane)}
          </p>
        </div>
        <Badge variant={lane === "approved" ? "default" : "secondary"}>
          {items.length}
        </Badge>
      </header>

      <SortableContext
        items={items.map((item) => getQueueRequestId(item.id))}
        strategy={verticalListSortingStrategy}
      >
        <div className={"grid gap-3"}>
          {items.map((item) => {
            const approvedIndex = approvedItems.findIndex(
              (approvedItem) => approvedItem.id === item.id,
            );

            return (
              <SortableQueueRequest
                key={item.id}
                item={item}
                lane={lane}
                canManage={canManage}
                canMoveUp={approvedIndex > 0}
                canMoveDown={
                  approvedIndex >= 0 &&
                  approvedIndex < approvedItems.length - 1
                }
                onAction={onAction}
                onMove={onMove}
              />
            );
          })}
        </div>
      </SortableContext>

      {items.length === 0 ? (
        <div className={"grid min-h-28 place-items-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground"}>
          Upuść zgłoszenie tutaj
        </div>
      ) : null}
    </section>
  );
}

type SortableQueueRequestProps = {
  item: DashboardEventQueueItemDto;
  lane: QueueBoardLane;
  canManage: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onAction: (requestId: number, action: DashboardEventQueueAction) => void;
  onMove: (
    requestId: number,
    direction: DashboardEventQueueMoveDirection,
  ) => void;
};

function SortableQueueRequest({
  item,
  lane,
  canManage,
  canMoveUp,
  canMoveDown,
  onAction,
  onMove,
}: SortableQueueRequestProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: getQueueRequestId(item.id),
    data: {
      type: "request",
      requestId: item.id,
      lane,
    } satisfies QueueRequestDragData,
    disabled: !canManage,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
    >
      <EventQueueRequestRow
        item={item}
        canManage={canManage}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onAction={onAction}
        onMove={onMove}
        dragHandle={
          canManage ? (
            <Button
              ref={setActivatorNodeRef}
              size="icon-sm"
              variant="ghost"
              type="button"
              className={"touch-none cursor-grab active:cursor-grabbing"}
              aria-label={`Przeciągnij zgłoszenie: ${item.displayName || item.singerName} — ${item.song.title}`}
              title="Przeciągnij zgłoszenie"
              {...attributes}
              {...listeners}
            >
              <GripVertical aria-hidden="true" />
            </Button>
          ) : null
        }
      />
    </div>
  );
}

type EventQueueRequestRowProps = {
  item: DashboardEventQueueItemDto;
  canManage: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragHandle?: ReactNode;
  onAction: (
    requestId: number,
    action: DashboardEventQueueAction,
  ) => void;
  onMove: (
    requestId: number,
    direction: DashboardEventQueueMoveDirection,
  ) => void;
};

function EventQueueRequestRow({
  item,
  canManage,
  canMoveUp,
  canMoveDown,
  dragHandle,
  onAction,
  onMove,
}: EventQueueRequestRowProps) {
  const actions = getAvailableActions(item.status);
  const duration = formatDuration(item.song.durationSeconds);

  return (
    <article className={"relative grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm sm:grid-cols-[minmax(12rem,1fr)_auto]"}>
      {dragHandle ? (
        <div className={"absolute right-2 top-2 z-10"}>{dragHandle}</div>
      ) : null}
      <div className={"min-w-0"}>
        <div className={"flex flex-wrap items-center gap-2 pr-9 [&_strong]:text-base"}>
          <strong>{item.displayName || item.singerName}</strong>
          <RequestStatusBadge status={item.status} />
          <Badge variant="outline">
            {item.requestedBy === "public" ? "Link sesji" : "Operator"}
          </Badge>
        </div>
        <div className={"mt-2 flex flex-wrap items-center gap-2"}>
          <p className={"m-0 text-sm font-semibold leading-snug"}>{item.song.title}</p>
        </div>
        <p className={"mt-0.5 text-sm leading-snug text-muted-foreground"}>{item.song.artist}</p>
        {item.note ? <p className={"mt-2 text-sm leading-relaxed text-muted-foreground"}>Notatka: {item.note}</p> : null}
      </div>

      <div className={"flex flex-row flex-wrap gap-1 text-xs text-muted-foreground sm:flex-col sm:items-end sm:whitespace-nowrap"}>
        <span>
          Pozycja: {item.status === "approved" ? item.position : "—"}
        </span>
        <span>{formatDateTime(item.createdAt)}</span>
        {duration ? <span>Czas: {duration}</span> : null}
      </div>

      {canManage && (actions.length > 0 || item.status === "approved") ? (
        <div className={"col-span-full flex flex-wrap gap-2"}>
          {item.status === "approved" ? (
            <>
              <Button
                size="icon-sm"
                variant="outline"
                type="button"
                title="Przesuń w górę"
                aria-label="Przesuń zgłoszenie w górę"
                onClick={() => void onMove(item.id, "up")}
                disabled={!canMoveUp}
              >
                <ArrowUp aria-hidden="true" data-icon="inline-start" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                type="button"
                title="Przesuń w dół"
                aria-label="Przesuń zgłoszenie w dół"
                onClick={() => void onMove(item.id, "down")}
                disabled={!canMoveDown}
              >
                <ArrowDown aria-hidden="true" data-icon="inline-start" />
              </Button>
            </>
          ) : null}

          {actions.map((action) => {
            if (action === "reject") {
              return (
                <AlertDialog key={action}>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="destructive"
                      type="button"
                    >
                      {getActionIcon(action)}
                      {actionLabels[action]}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent data-management-theme="true">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Odrzucić zgłoszenie?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Zgłoszenie zniknie z aktywnej kolejki. Można je później
                        przywrócić.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Anuluj</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => void onAction(item.id, action)}
                      >
                        Odrzuć zgłoszenie
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              );
            }

            return (
              <Button
                key={action}
                size="sm"
                variant="default"
                type="button"
                onClick={() => void onAction(item.id, action)}
              >
                {getActionIcon(action)}
                {actionLabels[action]}
              </Button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function getAvailableActions(status: DashboardEventQueueRequestStatus) {
  return (["approve", "start", "reject", "done", "restore"] as const).filter((action) =>
    canApplyDashboardEventQueueAction(action, status),
  );
}

function getQueueLaneId(lane: QueueBoardLane) {
  return `queue-lane:${lane}`;
}

function getQueueRequestId(requestId: number) {
  return `queue-request:${requestId}`;
}

function getQueueLaneDescription(lane: QueueBoardLane) {
  switch (lane) {
    case "pending":
      return "Nowe zgłoszenia do decyzji";
    case "approved":
      return "Kolejność występów";
    case "rejected":
      return "Zgłoszenia poza kolejką";
  }
}

function getLaneTransitionAction(
  sourceLane: QueueBoardLane,
  targetLane: QueueBoardLane,
): DashboardEventQueueAction | null {
  if (sourceLane === targetLane) {
    return null;
  }

  if (targetLane === "approved") {
    return "approve";
  }

  if (targetLane === "pending") {
    return "restore";
  }

  return "reject";
}

function getApprovedDropPosition(
  dropData: QueueDropData,
  approvedItems: DashboardEventQueueItemDto[],
) {
  if (dropData.lane !== "approved") {
    return null;
  }

  if (dropData.type === "lane") {
    return approvedItems.length + 1;
  }

  const dropIndex = approvedItems.findIndex(
    (item) => item.id === dropData.requestId,
  );

  return dropIndex >= 0 ? dropIndex + 1 : approvedItems.length + 1;
}

function getActionIcon(action: DashboardEventQueueAction) {
  switch (action) {
    case "approve":
      return <Check aria-hidden="true" data-icon="inline-start" />;
    case "start":
      return <Mic2 aria-hidden="true" data-icon="inline-start" />;
    case "reject":
      return <X aria-hidden="true" data-icon="inline-start" />;
    case "done":
      return <CircleCheck aria-hidden="true" data-icon="inline-start" />;
    case "restore":
      return <RotateCcw aria-hidden="true" data-icon="inline-start" />;
  }
}

function formatDateTime(value: string) {
  return formatWarsawDateTime(value);
}

function getClientErrorMessage(error: unknown) {
  if (!(error instanceof OperatorClientError)) {
    return "Nie udało się zapisać zmiany. Spróbuj ponownie.";
  }

  switch (error.code) {
    case "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN":
      return "Nie masz uprawnień do zarządzania tą kolejką.";
    case "EVENT_NOT_FOUND":
    case "REQUEST_NOT_FOUND":
    case "WORKSPACE_NOT_FOUND":
      return "Nie znaleziono wydarzenia albo zgłoszenia.";
    case "INVALID_STATUS_TRANSITION":
      return "Status zgłoszenia zmienił się i ta akcja nie jest już dostępna.";
    case "QUEUE_ACTION_CONFLICT":
      return "Zgłoszenie zostało w międzyczasie zmienione. Odśwież kolejkę.";
    case "QUEUE_REQUEST_NOT_REORDERABLE":
      return "Można zmieniać kolejność tylko zaakceptowanych zgłoszeń.";
    case "SERVICE_UNAVAILABLE":
      return "Usługa jest chwilowo niedostępna. Spróbuj ponownie za moment.";
    case "VALIDATION_ERROR":
    case "INVALID_JSON":
      return "Nie udało się poprawnie odczytać operacji.";
    default:
      return "Nie udało się zapisać zmiany. Spróbuj ponownie.";
  }
}

function formatLiveStatus(status: QueueRealtimeConnectionStatus) {
  switch (status) {
    case "live":
      return "Live połączone";
    case "unavailable":
      return "Live niedostępne";
    default:
      return "Łączenie live…";
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
