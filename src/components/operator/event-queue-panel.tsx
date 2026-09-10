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
  type KeyboardCoordinateGetter,
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
  CircleDot,
  GripVertical,
  LockKeyhole,
  Mic2,
  RefreshCw,
  RotateCcw,
  WifiOff,
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
  CardDescription,
} from "@/components/ui/card";
import type { DashboardEventLifecycleStatus } from "@/lib/dashboard-event-lifecycle";
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
  reconcileDashboardEventQueueItem,
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
  start: "Rozpocznij występ",
  reject: "Odrzuć",
  done: "Oznacz jako zagrane",
  restore: "Przywróć",
};

const destructiveButtonClassName =
  "border-destructive bg-destructive text-background hover:bg-destructive hover:brightness-95 focus-visible:border-destructive focus-visible:ring-destructive/35 disabled:border-border disabled:bg-muted disabled:text-foreground disabled:opacity-100";

type EventQueuePanelProps = {
  organizationId: string;
  eventId: string;
  realtimeEventId: number;
  canManage: boolean;
  lifecycle: DashboardEventLifecycleStatus;
  publicQueueEnabled: boolean;
  initialItems: DashboardEventQueueItemDto[];
};

type QueueRefreshReason = QueueRealtimeInvalidateReason | "local";
type QueueBoardLane = "pending" | "approved" | "rejected";

type QueueOptimisticOperation =
  | {
      id: number;
      kind: "action";
      requestId: number;
      action: DashboardEventQueueAction;
      changedAt: string;
    }
  | {
      id: number;
      kind: "move";
      requestId: number;
      direction: DashboardEventQueueMoveDirection;
      changedAt: string;
    }
  | {
      id: number;
      kind: "move-to-position";
      requestId: number;
      targetPosition: number;
      changedAt: string;
    };

type QueueOptimisticOperationInput =
  | Omit<Extract<QueueOptimisticOperation, { kind: "action" }>, "id" | "changedAt">
  | Omit<Extract<QueueOptimisticOperation, { kind: "move" }>, "id" | "changedAt">
  | Omit<
      Extract<QueueOptimisticOperation, { kind: "move-to-position" }>,
      "id" | "changedAt"
    >;

type QueueOptimisticState = {
  baseItems: DashboardEventQueueItemDto[];
  pendingOperations: QueueOptimisticOperation[];
};

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

  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }

  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => container.id !== args.active.id,
    ),
  });
};

const queueKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const direction = getKeyboardDirection(event.code);
  const { active, collisionRect, droppableContainers, droppableRects, over } =
    args.context;

  if (!direction || !active || !collisionRect) {
    return sortableKeyboardCoordinates(event, args);
  }

  event.preventDefault();

  const activeData = active.data.current as QueueRequestDragData | undefined;
  const overData = over?.data.current as QueueDropData | undefined;
  const currentLane = overData?.lane ?? activeData?.lane;

  if (!currentLane) {
    return sortableKeyboardCoordinates(event, args);
  }

  const collisionCenter = getRectCenter(collisionRect);
  const enabledContainers = droppableContainers.getEnabled();
  const sameLaneRequest =
    direction === "up" || direction === "down"
      ? enabledContainers
          .map((container) => {
            const data = container.data.current as QueueDropData | undefined;
            const rect = droppableRects.get(container.id);

            if (
              container.id === active.id ||
              data?.type !== "request" ||
              data.lane !== currentLane ||
              !rect ||
              !isRectInKeyboardDirection(
                getRectCenter(rect),
                collisionCenter,
                direction,
              )
            ) {
              return null;
            }

            const center = getRectCenter(rect);
            return {
              rect,
              primaryDistance: Math.abs(center.y - collisionCenter.y),
              distance: Math.hypot(
                center.x - collisionCenter.x,
                center.y - collisionCenter.y,
              ),
            };
          })
          .filter((candidate): candidate is NonNullable<typeof candidate> =>
            Boolean(candidate),
          )
          .sort(
            (left, right) =>
              left.primaryDistance - right.primaryDistance ||
              left.distance - right.distance,
          )[0]
      : null;

  if (sameLaneRequest) {
    return getKeyboardRequestCoordinates(
      sameLaneRequest.rect,
      collisionRect,
      direction,
    );
  }

  const targetLane = enabledContainers
    .map((container) => {
      const data = container.data.current as QueueDropData | undefined;
      const rect = droppableRects.get(container.id);

      if (
        data?.type !== "lane" ||
        data.lane === currentLane ||
        !rect ||
        !isRectInKeyboardDirection(
          getRectCenter(rect),
          collisionCenter,
          direction,
        )
      ) {
        return null;
      }

      const center = getRectCenter(rect);
      return {
        rect,
        distance: Math.hypot(
          center.x - collisionCenter.x,
          center.y - collisionCenter.y,
        ),
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate),
    )
    .sort((left, right) => left.distance - right.distance)[0];

  if (!targetLane) {
    return undefined;
  }

  return {
    x: targetLane.rect.left,
    y: targetLane.rect.top,
  };
};

export function EventQueuePanel({
  organizationId,
  eventId,
  realtimeEventId,
  canManage,
  lifecycle,
  publicQueueEnabled,
  initialItems,
}: EventQueuePanelProps) {
  const [queueState, setQueueState] = useState<QueueOptimisticState>({
    baseItems: initialItems,
    pendingOperations: [],
  });
  const queueStateRef = useRef(queueState);
  const items = useMemo(
    () =>
      replayQueueOptimisticOperations(
        queueState.baseItems,
        queueState.pendingOperations,
      ),
    [queueState],
  );
  const [activeDragRequestId, setActiveDragRequestId] = useState<number | null>(
    null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<
    "mutation" | "refresh" | null
  >(null);
  const [queueClosedDetected, setQueueClosedDetected] = useState(false);
  const queuePanelRef = useRef<HTMLElement | null>(null);
  const focusRequestIdRef = useRef<number | null>(null);
  const operationFocusRequestIdsRef = useRef(new Map<number, number>());
  const localMutationVersionRef = useRef(0);
  const canonicalRequestGenerationRef = useRef(0);
  const queueClosedRef = useRef(false);
  const mutationAllowedByPropsRef = useRef(
    canManage && lifecycle === "active",
  );
  const mountedRef = useRef(false);
  const focusAnimationFrameRef = useRef<number | null>(null);
  const localRefreshAbortControllerRef = useRef<AbortController | null>(null);
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
  const updateQueueState = useCallback(
    (update: (currentState: QueueOptimisticState) => QueueOptimisticState) => {
      const nextState = update(queueStateRef.current);
      queueStateRef.current = nextState;
      if (mountedRef.current) {
        setQueueState(nextState);
      }
    },
    [],
  );
  const replaceQueueBase = useCallback(
    (baseItems: DashboardEventQueueItemDto[]) => {
      updateQueueState((currentState) => ({
        ...currentState,
        baseItems,
      }));
    },
    [updateQueueState],
  );
  const scheduleQueueRequestFocus = useCallback((requestId: number) => {
    if (focusAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(focusAnimationFrameRef.current);
    }

    focusAnimationFrameRef.current = window.requestAnimationFrame(() => {
      focusAnimationFrameRef.current = null;
      if (!mountedRef.current) {
        return;
      }

      const requestRow = queuePanelRef.current?.querySelector<HTMLElement>(
        `[data-queue-request-id="${requestId}"]`,
      );
      if (
        requestRow?.isConnected &&
        requestRow.hasAttribute("tabindex") &&
        !requestRow.closest('[hidden], [inert], [aria-hidden="true"]')
      ) {
        requestRow.focus();
        focusRequestIdRef.current = null;
      }
    });
  }, []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: queueKeyboardCoordinates }),
  );
  const canMutate =
    canManage && lifecycle === "active" && !queueClosedDetected;
  const pendingMutationCount = queueState.pendingOperations.length;
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
  const beginCanonicalRequest = useCallback(() => {
    canonicalRequestGenerationRef.current += 1;
    return canonicalRequestGenerationRef.current;
  }, []);
  const isCanonicalRequestCurrent = useCallback(
    (generation: number) =>
      mountedRef.current &&
      canonicalRequestGenerationRef.current === generation,
    [],
  );
  const flushQueuedRealtimeRefresh = useCallback(() => {
    if (
      !mountedRef.current ||
      queueStateRef.current.pendingOperations.length > 0 ||
      realtimeRefreshInFlightRef.current ||
      !realtimeRefreshQueuedRef.current
    ) {
      return;
    }

    realtimeRefreshQueuedRef.current = false;
    const controller = new AbortController();
    localRefreshAbortControllerRef.current?.abort();
    localRefreshAbortControllerRef.current = controller;
    void refreshFromRealtimeRef.current?.("local", controller.signal).finally(
      () => {
        if (localRefreshAbortControllerRef.current === controller) {
          localRefreshAbortControllerRef.current = null;
        }
      },
    );
  }, []);
  const refreshFromRealtime = useCallback(
    async (
      reason: QueueRefreshReason,
      signal: AbortSignal,
    ) => {
      if (
        queueStateRef.current.pendingOperations.length > 0 ||
        realtimeRefreshInFlightRef.current
      ) {
        realtimeRefreshQueuedRef.current = true;
        return;
      }

      const canonicalGeneration = beginCanonicalRequest();
      const mutationVersionAtStart = localMutationVersionRef.current;
      const showSyncIndicator = reason !== "subscribe" && reason !== "local";
      realtimeRefreshInFlightRef.current = true;
      setIsRefreshing(false);
      setIsSyncing(showSyncIndicator);

      try {
        const response = await getDashboardEventQueue(
          organizationId,
          eventId,
          signal,
        );

        if (!isCanonicalRequestCurrent(canonicalGeneration)) {
          return;
        }

        if (
          queueStateRef.current.pendingOperations.length > 0 ||
          localMutationVersionRef.current !== mutationVersionAtStart
        ) {
          realtimeRefreshQueuedRef.current = true;
          return;
        }

        replaceQueueBase(response.items);
        setError(null);
        setErrorSource(null);
      } catch (caughtError) {
        if (
          signal.aborted ||
          isAbortError(caughtError) ||
          !isCanonicalRequestCurrent(canonicalGeneration)
        ) {
          return;
        }

        if (
          queueStateRef.current.pendingOperations.length > 0 ||
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

        setError(getRefreshErrorMessage());
        setErrorSource("refresh");
      } finally {
        realtimeRefreshInFlightRef.current = false;

        if (isCanonicalRequestCurrent(canonicalGeneration)) {
          setIsSyncing(false);
        }

        if (mountedRef.current) {
          flushQueuedRealtimeRefresh();
        }
      }
    },
    [
      beginCanonicalRequest,
      eventId,
      flushQueuedRealtimeRefresh,
      isCanonicalRequestCurrent,
      organizationId,
      replaceQueueBase,
    ],
  );
  useEffect(() => {
    mountedRef.current = true;
    refreshFromRealtimeRef.current = refreshFromRealtime;
    const operationFocusRequestIds = operationFocusRequestIdsRef.current;

    return () => {
      mountedRef.current = false;
      canonicalRequestGenerationRef.current += 1;
      operationFocusRequestIds.clear();
      if (focusAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(focusAnimationFrameRef.current);
        focusAnimationFrameRef.current = null;
      }
      localRefreshAbortControllerRef.current?.abort();
      localRefreshAbortControllerRef.current = null;
      refreshFromRealtimeRef.current = null;
    };
  }, [refreshFromRealtime]);
  useEffect(() => {
    mutationAllowedByPropsRef.current = canManage && lifecycle === "active";

    if (lifecycle === "active") {
      queueClosedRef.current = false;
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled && mountedRef.current) {
          setQueueClosedDetected(false);
        }
      });

      return () => {
        cancelled = true;
      };
    }
  }, [canManage, lifecycle]);
  useEffect(() => {
    const focusRequestId = focusRequestIdRef.current;

    if (focusRequestId === null) {
      return;
    }

    scheduleQueueRequestFocus(focusRequestId);
  }, [items, scheduleQueueRequestFocus]);
  const liveStatus = useDashboardQueueRealtime(
    realtimeEventId,
    refreshFromRealtime,
  );

  async function refreshQueue({
    announceSuccess = true,
  }: { announceSuccess?: boolean } = {}): Promise<boolean> {
    const canonicalGeneration = beginCanonicalRequest();
    const mutationVersionAtStart = localMutationVersionRef.current;
    const controller = new AbortController();

    localRefreshAbortControllerRef.current?.abort();
    localRefreshAbortControllerRef.current = controller;

    setIsRefreshing(true);
    setIsSyncing(false);
    setError(null);
    setErrorSource(null);

    try {
      const response = await getDashboardEventQueue(
        organizationId,
        eventId,
        controller.signal,
      );

      if (!isCanonicalRequestCurrent(canonicalGeneration)) {
        return false;
      }

      if (
        queueStateRef.current.pendingOperations.length > 0 ||
        localMutationVersionRef.current !== mutationVersionAtStart
      ) {
        realtimeRefreshQueuedRef.current = true;
        return false;
      }

      replaceQueueBase(response.items);
      setError(null);
      setErrorSource(null);
      if (announceSuccess) toast.success("Kolejka zaktualizowana");
      return true;
    } catch (caughtError) {
      if (
        controller.signal.aborted ||
        isAbortError(caughtError) ||
        !isCanonicalRequestCurrent(canonicalGeneration)
      ) {
        return false;
      }

      if (!handleAuthenticationError(caughtError)) {
        setError(getRefreshErrorMessage());
        setErrorSource("refresh");
      }
      return false;
    } finally {
      if (localRefreshAbortControllerRef.current === controller) {
        localRefreshAbortControllerRef.current = null;
      }
      if (isCanonicalRequestCurrent(canonicalGeneration)) {
        setIsRefreshing(false);
        flushQueuedRealtimeRefresh();
      }
    }
  }

  function handleAction(
    requestId: number,
    action: DashboardEventQueueAction,
    restoreFocus = false,
  ) {
    if (!canMutate) {
      return;
    }

    const operation = beginLocalMutation(
      {
        kind: "action",
        requestId,
        action,
      },
      restoreFocus ? requestId : null,
    );
    setError(null);
    setErrorSource(null);

    scheduleMutation(async () => {
      if (!canRunMutationTask()) {
        discardOptimisticOperation(operation.id);
        return;
      }

      try {
        const result = await runDashboardEventQueueAction(
          organizationId,
          eventId,
          requestId,
          action,
        );

        confirmOptimisticOperation(operation.id, result.request);
      } catch (caughtError) {
        await handleMutationError(caughtError, operation.id);
      }
    });
  }

  function handleMove(
    requestId: number,
    direction: DashboardEventQueueMoveDirection,
  ) {
    if (!canMutate) {
      return;
    }

    const operation = beginLocalMutation({
      kind: "move",
      requestId,
      direction,
    });
    setError(null);
    setErrorSource(null);

    scheduleMutation(async () => {
      if (!canRunMutationTask()) {
        discardOptimisticOperation(operation.id);
        return;
      }

      try {
        const result = await moveDashboardEventQueueRequest(
          organizationId,
          eventId,
          requestId,
          direction,
        );

        if (result.moved) {
          confirmOptimisticOperation(operation.id, result.request);
        } else {
          discardOptimisticOperation(operation.id);
        }
      } catch (caughtError) {
        await handleMutationError(caughtError, operation.id);
      }
    });
  }

  function handleMoveToPosition(
    requestId: number,
    targetPosition: number,
    restoreFocus = false,
  ) {
    if (!canMutate) {
      return;
    }

    const operation = beginLocalMutation(
      {
        kind: "move-to-position",
        requestId,
        targetPosition,
      },
      restoreFocus ? requestId : null,
    );
    setError(null);
    setErrorSource(null);

    scheduleMutation(async () => {
      if (!canRunMutationTask()) {
        discardOptimisticOperation(operation.id);
        return;
      }

      try {
        const result = await moveDashboardEventQueueRequest(
          organizationId,
          eventId,
          requestId,
          { targetPosition },
        );

        if (result.moved) {
          confirmOptimisticOperation(operation.id, result.request);
        } else {
          discardOptimisticOperation(operation.id);
        }
      } catch (caughtError) {
        await handleMutationError(caughtError, operation.id);
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

    const dragData = event.active.data.current as
      | QueueRequestDragData
      | undefined;

    if (dragData?.type !== "request") {
      return;
    }

    if (!canMutate || !event.over) {
      scheduleQueueRequestFocus(dragData.requestId);
      return;
    }

    const dropData = event.over.data.current as QueueDropData | undefined;

    if (!dropData) {
      scheduleQueueRequestFocus(dragData.requestId);
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
        scheduleQueueRequestFocus(dragData.requestId);
        return;
      }

      if (targetLane === "approved" && targetPosition !== null) {
        handleMoveToPosition(dragData.requestId, targetPosition, true);
      } else {
        scheduleQueueRequestFocus(dragData.requestId);
      }
      return;
    }

    const action = getLaneTransitionAction(sourceLane, targetLane);

    if (!action) {
      scheduleQueueRequestFocus(dragData.requestId);
      return;
    }

    handleAction(dragData.requestId, action, true);

    if (targetLane === "approved" && targetPosition !== null) {
      handleMoveToPosition(dragData.requestId, targetPosition);
    }
  }

  function handleDragCancel() {
    const requestId = activeDragRequestId;
    setActiveDragRequestId(null);

    if (requestId !== null) {
      scheduleQueueRequestFocus(requestId);
    }
  }

  function beginLocalMutation(
    operation: QueueOptimisticOperationInput,
    focusRequestId: number | null = null,
  ) {
    localMutationVersionRef.current += 1;
    realtimeRefreshQueuedRef.current = true;
    const queuedOperation = {
      ...operation,
      id: localMutationVersionRef.current,
      changedAt: new Date().toISOString(),
    } as QueueOptimisticOperation;

    if (focusRequestId !== null) {
      operationFocusRequestIdsRef.current.set(
        queuedOperation.id,
        focusRequestId,
      );
      focusRequestIdRef.current = focusRequestId;
    }

    updateQueueState((currentState) => ({
      ...currentState,
      pendingOperations: [
        ...currentState.pendingOperations,
        queuedOperation,
      ],
    }));

    return queuedOperation;
  }

  function scheduleMutation(task: () => Promise<void>) {
    const queuedTask = mutationQueueRef.current.then(task, task);

    mutationQueueRef.current = queuedTask.then(
      () => finishLocalMutation(),
      () => finishLocalMutation(),
    );
  }

  function finishLocalMutation() {
    flushQueuedRealtimeRefresh();
  }

  async function handleMutationError(
    caughtError: unknown,
    operationId: number,
  ) {
    const queueWasClosed = isEventQueueClosedError(caughtError);
    const activeDuplicate = isActiveQueueDuplicateError(caughtError);

    if (queueWasClosed) {
      queueClosedRef.current = true;
    }

    discardOptimisticOperation(operationId);

    if (!mountedRef.current) {
      return;
    }

    if (handleAuthenticationError(caughtError)) {
      return;
    }

    if (queueWasClosed) {
      localMutationVersionRef.current += 1;
      discardAllOptimisticOperations();
      setQueueClosedDetected(true);
      setError(null);
      setErrorSource(null);
      realtimeRefreshQueuedRef.current = false;

      const canonicalGeneration = beginCanonicalRequest();
      const controller = new AbortController();
      localRefreshAbortControllerRef.current?.abort();
      localRefreshAbortControllerRef.current = controller;
      setIsRefreshing(false);
      setIsSyncing(false);

      try {
        const response = await getDashboardEventQueue(
          organizationId,
          eventId,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          !isCanonicalRequestCurrent(canonicalGeneration)
        ) {
          return;
        }
        replaceQueueBase(response.items);
      } catch (refreshError) {
        if (
          !controller.signal.aborted &&
          !isAbortError(refreshError) &&
          isCanonicalRequestCurrent(canonicalGeneration) &&
          !handleAuthenticationError(refreshError)
        ) {
          setError(
            "Nie udało się odświeżyć kolejki po jej zamknięciu. Spróbuj ponownie.",
          );
          setErrorSource("refresh");
        }
      } finally {
        if (localRefreshAbortControllerRef.current === controller) {
          localRefreshAbortControllerRef.current = null;
        }
      }

      return;
    }

    if (activeDuplicate) {
      const refreshed = await refreshQueue({ announceSuccess: false });
      if (mountedRef.current) {
        setError(
          refreshed
            ? `${getClientErrorMessage(caughtError)} Kolejka została odświeżona.`
            : `${getClientErrorMessage(caughtError)} Nie udało się odświeżyć kolejki. Odśwież ją ręcznie.`,
        );
        setErrorSource("mutation");
      }
      return;
    }

    setError(getClientErrorMessage(caughtError));
    setErrorSource("mutation");
  }

  function confirmOptimisticOperation(
    operationId: number,
    confirmedRequest: DashboardEventQueueItemDto,
  ) {
    operationFocusRequestIdsRef.current.delete(operationId);
    updateQueueState((currentState) => {
      const operation = currentState.pendingOperations.find(
        (candidate) => candidate.id === operationId,
      );

      if (!operation) {
        return currentState;
      }

      return {
        baseItems: reconcileDashboardEventQueueItem(
          applyQueueOptimisticOperation(currentState.baseItems, operation),
          confirmedRequest,
        ),
        pendingOperations: currentState.pendingOperations.filter(
          (candidate) => candidate.id !== operationId,
        ),
      };
    });
  }

  function discardOptimisticOperation(operationId: number) {
    const focusRequestId = operationFocusRequestIdsRef.current.get(operationId);
    operationFocusRequestIdsRef.current.delete(operationId);

    if (focusRequestId !== undefined && mountedRef.current) {
      focusRequestIdRef.current = focusRequestId;
    }

    updateQueueState((currentState) => ({
      ...currentState,
      pendingOperations: currentState.pendingOperations.filter(
        (operation) => operation.id !== operationId,
      ),
    }));
  }

  function discardAllOptimisticOperations() {
    operationFocusRequestIdsRef.current.clear();
    updateQueueState((currentState) => ({
      ...currentState,
      pendingOperations: [],
    }));
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

  function canRunMutationTask() {
    return mutationAllowedByPropsRef.current && !queueClosedRef.current;
  }

  return (
    <section
      ref={queuePanelRef}
      aria-labelledby="event-queue-heading"
      className="@container/queue grid min-w-0 gap-5"
      data-event-queue-panel
    >
      <header className="flex min-w-0 flex-col gap-4 border-b border-border pb-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h2
            id="event-queue-heading"
            className="text-xl font-semibold tracking-[-0.02em]"
          >
            Kolejka operacyjna
          </h2>
          <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">
            Zgłoszenia tego wydarzenia. Zmiany są widoczne od razu, a zapis
            odbywa się kolejno w tle.
          </p>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge
            variant={liveStatus === "live" ? "default" : "secondary"}
            data-realtime-status={liveStatus}
          >
            {liveStatus === "live" ? (
              <CircleDot aria-hidden="true" data-icon="inline-start" />
            ) : liveStatus === "unavailable" ? (
              <WifiOff aria-hidden="true" data-icon="inline-start" />
            ) : (
              <RefreshCw
                aria-hidden="true"
                className="animate-spin"
                data-icon="inline-start"
              />
            )}
            {formatLiveStatus(liveStatus)}
          </Badge>
          <Badge variant="secondary">
            Kolejka publiczna: {publicQueueEnabled ? "włączona" : "wyłączona"}
          </Badge>
          <Badge variant="outline">
            {canMutate
              ? "Możesz zarządzać"
              : canManage
                ? "Zmiany niedostępne"
                : "Tylko podgląd"}
          </Badge>
          {isSyncing ? (
            <Badge variant="secondary" role="status">
              Synchronizacja…
            </Badge>
          ) : null}
          {pendingMutationCount > 0 ? (
            <Badge variant="secondary" role="status">
              Trwa zapis…
            </Badge>
          ) : null}
          {errorSource === "refresh" ? (
            <Badge variant="destructive" role="status">
              Błąd synchronizacji
            </Badge>
          ) : null}
          <Button
            variant="outline"
            type="button"
            onClick={() => void refreshQueue()}
            disabled={isRefreshing}
          >
            <RefreshCw
              aria-hidden="true"
              className={isRefreshing ? "animate-spin" : undefined}
              data-icon="inline-start"
            />
            {isRefreshing ? "Odświeżanie…" : "Odśwież"}
          </Button>
        </div>
      </header>

      {!canManage || lifecycle !== "active" || queueClosedDetected ? (
        <Alert
          data-queue-closed={
            lifecycle !== "active" || queueClosedDetected ? true : undefined
          }
        >
          <LockKeyhole aria-hidden="true" />
          <AlertTitle>
            {lifecycle !== "active" || queueClosedDetected
              ? "Kolejka jest zamknięta"
              : "Tryb tylko do odczytu"}
          </AlertTitle>
          <AlertDescription>
            {!canManage ? (
              <>
                Rola viewer pozwala przeglądać kolejkę, ale nie zmieniać
                statusów zgłoszeń ani ich kolejności.
                {lifecycle !== "active" || queueClosedDetected
                  ? ` ${getClosedQueueDescription(lifecycle, queueClosedDetected)}`
                  : null}
              </>
            ) : (
              getClosedQueueDescription(lifecycle, queueClosedDetected)
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>
            {errorSource === "mutation"
              ? "Nie udało się zapisać zmiany"
              : "Nie udało się zsynchronizować kolejki"}
          </AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {items.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-border px-4 py-6 text-center"
          data-queue-empty
        >
          <p className="text-sm font-semibold">Brak zgłoszeń</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nowe zgłoszenia z linku sesji pojawią się tutaj.
          </p>
        </div>
      ) : null}

      <section
        className="grid gap-3 border-b border-border pb-5"
        aria-labelledby="current-performance-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="current-performance-heading" className="text-base font-semibold">
              Aktualnie śpiewane
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Jedno bieżące zgłoszenie w wydarzeniu.
            </p>
          </div>
          <Badge variant={currentItem ? "default" : "secondary"}>
            {currentItem ? "Występ trwa" : "Scena wolna"}
          </Badge>
        </div>
        {currentItem ? (
          <EventQueueRequestRow
            item={currentItem}
            canManage={canMutate}
            canMoveUp={false}
            canMoveDown={false}
            onAction={handleAction}
            onMove={handleMove}
          />
        ) : (
          <CardDescription className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
            Żadne zgłoszenie nie jest teraz oznaczone jako śpiewane.
          </CardDescription>
        )}
      </section>

      <DndContext
        id={`event-queue:${organizationId}:${eventId}`}
        sensors={sensors}
        collisionDetection={queueCollisionDetection}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
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
          className="grid grid-cols-1 items-start gap-4 @min-[48rem]/queue:grid-cols-2"
        >
          {queueBoardLanes.map((lane) => (
            <QueueLane
              key={lane}
              lane={lane}
              items={boardItems[lane]}
              approvedItems={approvedItems}
              canManage={canMutate}
              onAction={handleAction}
              onMove={handleMove}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDragItem ? (
            <div
              data-queue-drag-overlay
              className="h-full w-full opacity-95 shadow-2xl [&>article]:h-full"
            >
              <EventQueueRequestRow
                item={activeDragItem}
                isDragOverlay
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

      <section
        className="grid gap-3 border-t border-border pt-5"
        aria-labelledby="queue-history-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="queue-history-heading" className="text-base font-semibold">
              Historia
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Zagrane i pominięte zgłoszenia.
            </p>
          </div>
          <Badge variant="secondary">{closedItems.length}</Badge>
        </div>
        {closedItems.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {closedItems.map((item) => (
              <EventQueueRequestRow
                key={item.id}
                item={item}
                canManage={canMutate}
                canMoveUp={false}
                canMoveDown={false}
                onAction={handleAction}
                onMove={handleMove}
              />
            ))}
          </div>
        ) : (
          <CardDescription className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
            Historia jest jeszcze pusta.
          </CardDescription>
        )}
      </section>
    </section>
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
  onAction: (
    requestId: number,
    action: DashboardEventQueueAction,
    restoreFocus?: boolean,
  ) => void;
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
      aria-labelledby={getQueueLaneHeadingId(lane)}
      data-queue-lane={lane}
      className={[
        "grid min-h-48 content-start gap-3 rounded-xl border border-border bg-muted/25 p-3 transition-colors",
        lane === "rejected" ? "col-span-full" : "",
        isOver ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "",
      ].join(" ")}
    >
      <header className={"flex items-center justify-between gap-3 px-1"}>
        <div>
          <h3 id={getQueueLaneHeadingId(lane)} className={"font-semibold"}>
            {queueBoardLaneLabels[lane]}
          </h3>
          <p className={"mt-0.5 text-xs text-muted-foreground"}>
            {getQueueLaneDescription(lane)}
          </p>
        </div>
        <Badge variant={lane === "approved" ? "default" : "secondary"}>
          {items.length}
        </Badge>
      </header>

      {isOver ? (
        <p className="rounded-lg bg-primary/10 px-3 py-2 text-center text-xs font-semibold text-foreground" role="status">
          Upuść w sekcji „{queueBoardLaneLabels[lane]}”
        </p>
      ) : null}

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
  onAction: (
    requestId: number,
    action: DashboardEventQueueAction,
    restoreFocus?: boolean,
  ) => void;
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
              size="icon-lg"
              variant="ghost"
              type="button"
              className="size-11 touch-none cursor-grab active:cursor-grabbing sm:size-9"
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
  isDragOverlay?: boolean;
  onAction: (
    requestId: number,
    action: DashboardEventQueueAction,
    restoreFocus?: boolean,
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
  isDragOverlay = false,
  onAction,
  onMove,
}: EventQueueRequestRowProps) {
  const actions = getAvailableActions(item.status);
  const duration = formatDuration(item.song.durationSeconds);
  const requestLabel = getQueueRequestLabel(item);

  return (
    <article
      aria-label={`Zgłoszenie: ${requestLabel}`}
      aria-hidden={isDragOverlay ? true : undefined}
      data-queue-request-id={isDragOverlay ? undefined : item.id}
      tabIndex={isDragOverlay ? undefined : -1}
      className={[
        "relative grid min-w-0 grid-cols-1 gap-x-3 gap-y-2.5 rounded-xl border px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:grid-cols-[minmax(0,1fr)_auto]",
        item.status === "now"
          ? "border-primary/45 bg-accent/35"
          : "border-border bg-card",
      ].join(" ")}
    >
      {dragHandle ? (
        <div className={"absolute right-2 top-2 z-10"}>{dragHandle}</div>
      ) : null}
      <div className={"min-w-0"}>
        <div className="flex flex-wrap items-center gap-1.5 pr-10 [&_strong]:text-sm">
          <strong>{item.displayName || item.singerName}</strong>
          <RequestStatusBadge status={item.status} />
          <Badge variant="outline">
            {item.requestedBy === "public" ? "Link sesji" : "Operator"}
          </Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className={"m-0 text-sm font-semibold leading-snug"}>{item.song.title}</p>
        </div>
        <p className={"mt-0.5 text-sm leading-snug text-muted-foreground"}>{item.song.artist}</p>
        {item.note ? <p className={"mt-2 text-sm leading-relaxed text-muted-foreground"}>Notatka: {item.note}</p> : null}
      </div>

      <div className="flex flex-row flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground sm:flex-col sm:items-end sm:gap-1 sm:whitespace-nowrap">
        <span>
          Pozycja: {item.status === "approved" ? item.position : "—"}
        </span>
        <span>Zgłoszono: {formatDateTime(item.createdAt)}</span>
        {getQueueActivityTimestamp(item) ? (
          <span>{getQueueActivityTimestamp(item)}</span>
        ) : null}
        {duration ? <span>Czas: {duration}</span> : null}
      </div>

      {canManage && (actions.length > 0 || item.status === "approved") ? (
        <div className="col-span-full flex flex-wrap gap-2 border-t border-border pt-2.5">
          {item.status === "approved" ? (
            <>
              <Button
                size="icon-sm"
                variant="outline"
                type="button"
                className="size-11 sm:size-7"
                title="Przesuń w górę"
                aria-label={`Przesuń zgłoszenie w górę: ${requestLabel}`}
                onClick={() => void onMove(item.id, "up")}
                disabled={!canMoveUp}
              >
                <ArrowUp aria-hidden="true" data-icon="inline-start" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                type="button"
                className="size-11 sm:size-7"
                title="Przesuń w dół"
                aria-label={`Przesuń zgłoszenie w dół: ${requestLabel}`}
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
                      className={`${destructiveButtonClassName} min-h-11 sm:min-h-7`}
                      aria-label={getRequestActionLabel(action, item)}
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
                        className={`${destructiveButtonClassName} min-h-11 sm:min-h-7`}
                        aria-label={getRequestActionLabel(action, item)}
                        onClick={(event) =>
                          void onAction(item.id, action, event.detail === 0)
                        }
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
                variant={
                  action === "restore"
                    ? "outline"
                    : action === "start" && item.status === "pending"
                      ? "secondary"
                    : action === "done" && item.status !== "now"
                      ? "secondary"
                      : "default"
                }
                type="button"
                className="min-h-11 sm:min-h-7"
                aria-label={getRequestActionLabel(action, item)}
                onClick={(event) =>
                  void onAction(item.id, action, event.detail === 0)
                }
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

function getQueueLaneHeadingId(lane: QueueBoardLane) {
  return `queue-lane-${lane}-heading`;
}

function getQueueRequestId(requestId: number) {
  return `queue-request:${requestId}`;
}

function getQueueRequestLabel(item: DashboardEventQueueItemDto) {
  return `${item.displayName || item.singerName} — ${item.song.title}`;
}

function getRequestActionLabel(
  action: DashboardEventQueueAction,
  item: DashboardEventQueueItemDto,
) {
  return `${actionLabels[action]}: ${getQueueRequestLabel(item)}`;
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

function getQueueActivityTimestamp(item: DashboardEventQueueItemDto) {
  if (item.completedAt) {
    return `Zakończono: ${formatDateTime(item.completedAt)}`;
  }

  if (item.startedAt) {
    return `Rozpoczęto: ${formatDateTime(item.startedAt)}`;
  }

  return null;
}

function getClosedQueueDescription(
  lifecycle: DashboardEventLifecycleStatus,
  queueClosedDetected: boolean,
) {
  if (queueClosedDetected || lifecycle === "closed") {
    return "Wydarzenie zostało zamknięte. Możesz nadal przeglądać i odświeżać dane, ale operacje kolejki są niedostępne.";
  }

  if (lifecycle === "cancelled") {
    return "Wydarzenie zostało anulowane. Kolejka pozostaje dostępna wyłącznie do odczytu.";
  }

  return "Wydarzenie jeszcze się nie rozpoczęło. Zarządzanie kolejką będzie dostępne po jego rozpoczęciu.";
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
    case "QUEUE_ACTIVE_DUPLICATE":
      return "Ta osoba ma już aktywne zgłoszenie tej piosenki.";
    case "QUEUE_REQUEST_NOT_REORDERABLE":
      return "Można zmieniać kolejność tylko zaakceptowanych zgłoszeń.";
    case "EVENT_QUEUE_CLOSED":
      return "Wydarzenie zostało zamknięte. Kolejka jest dostępna tylko do odczytu.";
    case "SERVICE_UNAVAILABLE":
      return "Usługa jest chwilowo niedostępna. Spróbuj ponownie za moment.";
    case "VALIDATION_ERROR":
    case "INVALID_JSON":
      return "Nie udało się poprawnie odczytać operacji.";
    default:
      return "Nie udało się zapisać zmiany. Spróbuj ponownie.";
  }
}

function getRefreshErrorMessage() {
  return "Nie udało się pobrać aktualnych danych. Dotychczasowa kolejka pozostaje widoczna.";
}

function formatLiveStatus(status: QueueRealtimeConnectionStatus) {
  switch (status) {
    case "live":
      return "Aktualizacje na żywo";
    case "unavailable":
      return "Aktualizacje niedostępne";
    default:
      return "Łączenie…";
  }
}

function isEventQueueClosedError(error: unknown) {
  return (
    error instanceof OperatorClientError && error.code === "EVENT_QUEUE_CLOSED"
  );
}

function isActiveQueueDuplicateError(error: unknown) {
  return (
    error instanceof OperatorClientError &&
    error.code === "QUEUE_ACTIVE_DUPLICATE"
  );
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function replayQueueOptimisticOperations(
  baseItems: DashboardEventQueueItemDto[],
  operations: QueueOptimisticOperation[],
) {
  return operations.reduce(applyQueueOptimisticOperation, baseItems);
}

function applyQueueOptimisticOperation(
  items: DashboardEventQueueItemDto[],
  operation: QueueOptimisticOperation,
) {
  switch (operation.kind) {
    case "action":
      return applyOptimisticDashboardEventQueueAction(
        items,
        operation.requestId,
        operation.action,
        operation.changedAt,
      );
    case "move":
      return applyOptimisticDashboardEventQueueMove(
        items,
        operation.requestId,
        operation.direction,
        operation.changedAt,
      );
    case "move-to-position":
      return applyOptimisticDashboardEventQueueMoveToPosition(
        items,
        operation.requestId,
        operation.targetPosition,
        operation.changedAt,
      );
  }
}

type QueueKeyboardDirection = "up" | "down" | "left" | "right";

function getKeyboardDirection(code: string): QueueKeyboardDirection | null {
  switch (code) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    default:
      return null;
  }
}

function getRectCenter(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getKeyboardRequestCoordinates(
  targetRect: { left: number; top: number; width: number; height: number },
  collisionRect: { width: number; height: number },
  direction: QueueKeyboardDirection,
) {
  return {
    x: targetRect.left,
    y:
      direction === "down"
        ? targetRect.top - (collisionRect.height - targetRect.height)
        : targetRect.top,
  };
}

function isRectInKeyboardDirection(
  candidate: { x: number; y: number },
  origin: { x: number; y: number },
  direction: QueueKeyboardDirection,
) {
  switch (direction) {
    case "up":
      return candidate.y < origin.y;
    case "down":
      return candidate.y > origin.y;
    case "left":
      return candidate.x < origin.x;
    case "right":
      return candidate.x > origin.x;
  }
}
