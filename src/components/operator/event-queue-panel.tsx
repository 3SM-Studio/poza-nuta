"use client";

import { useUiText } from "@/i18n/use-ui-text";
import { localizeUiRecord } from "@/i18n/text";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleCheck,
  CircleDot,
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
  placeDashboardEventQueueRequest,
  moveDashboardEventQueueRequest,
  runDashboardEventQueueAction,
  type DashboardEventQueueItemDto,
} from "./event-queue-api";
import { useDashboardQueueRealtime } from "./use-dashboard-queue-realtime";
import { FairQueueControl } from "./fair-queue-control";
import { QueueDragBoard, QueueDragNotice } from "./queue-drag-board";
import { queuePlacementRevision, type QueueDropInput } from "@/lib/queue-placement";

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

type QueueOptimisticOperation =
  | { id: number; kind: "placement"; requestId: number; placement: QueueDropInput; changedAt: string }
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
;

type QueueOptimisticOperationInput =
  | Omit<Extract<QueueOptimisticOperation, { kind: "placement" }>, "id" | "changedAt">
  | Omit<Extract<QueueOptimisticOperation, { kind: "action" }>, "id" | "changedAt">
  | Omit<Extract<QueueOptimisticOperation, { kind: "move" }>, "id" | "changedAt">
;

type QueueOptimisticState = {
  baseItems: DashboardEventQueueItemDto[];
  pendingOperations: QueueOptimisticOperation[];
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
  const tx = useUiText();

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
  const dragActiveRef = useRef(false);
  const [dragActive, setDragActive] = useState(false);
  const [dragEpoch, setDragEpoch] = useState(0);
  const dragEpochRef = useRef(0);
  const [dragNotice, setDragNotice] = useState<string | null>(null);
  const [pendingReject, setPendingReject] = useState<{ requestId: number; placement: QueueDropInput } | null>(null);
  const rejectionFocusRequestRef = useRef<number | null>(null);
  const [placementBusy, setPlacementBusy] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<
    "mutation" | "refresh" | null
  >(null);
  const errorSourceRef = useRef(errorSource);
  useEffect(() => {
    errorSourceRef.current = errorSource;
  }, [errorSource]);
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
  const [fairQueueBusy, setFairQueueBusy] = useState(false);
  const fairQueueBusyRef = useRef(false);
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
        requestRow.focus({ preventScroll: true });
        focusRequestIdRef.current = null;
      }
    });
  }, []);
  const canMutate =
    canManage && lifecycle === "active" && !queueClosedDetected && !fairQueueBusy && !placementBusy && !pendingReject;
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
  const closedItems = useMemo(
    () =>
      items.filter(
        (item) => item.status === "done" || item.status === "skipped",
      ),
    [items],
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
        fairQueueBusyRef.current || queueStateRef.current.pendingOperations.length > 0 ||
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
      if (!dragActiveRef.current) setIsSyncing(showSyncIndicator);

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

        const sameRevision = queuePlacementRevision(response.items) === queuePlacementRevision(queueStateRef.current.baseItems);
        if (dragActiveRef.current && !sameRevision) {
          dragActiveRef.current = false;
          setDragActive(false);
          dragEpochRef.current += 1;
          setDragEpoch(dragEpochRef.current);
          setDragNotice("Kolejka została zaktualizowana. Przeciągnij zgłoszenie ponownie.");
        }
        // Focus/reconnect can refetch unchanged data. Keep the gesture and its
        // DOM stable; only a changed canonical version invalidates the intent.
        if (!dragActiveRef.current || !sameRevision) replaceQueueBase(response.items);
        // A background invalidation must not dismiss feedback about a denied
        // operator action. The next action or explicit refresh clears it.
        if (errorSourceRef.current !== "mutation" && !dragActiveRef.current) {
          setError(null);
          setErrorSource(null);
        }
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

        if (isCanonicalRequestCurrent(canonicalGeneration) && !dragActiveRef.current) {
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
    if (fairQueueBusyRef.current) return false;
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
      if (announceSuccess) toast.success(tx("Kolejka zaktualizowana"));
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
    if (!canMutate || dragActiveRef.current) {
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

        confirmOptimisticOperation(operation.id, result.request, result.items);
      } catch (caughtError) {
        await handleMutationError(caughtError, operation.id);
      }
    });
  }

  function handleMove(
    requestId: number,
    direction: DashboardEventQueueMoveDirection,
  ) {
    if (!canMutate || dragActiveRef.current) {
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
          confirmOptimisticOperation(operation.id, result.request, result.items);
        } else {
          discardOptimisticOperation(operation.id);
        }
      } catch (caughtError) {
        await handleMutationError(caughtError, operation.id);
      }
    });
  }

  function handlePlacement(requestId: number, placement: QueueDropInput) {
    if (!canMutate || queueStateRef.current.pendingOperations.length > 0) return;
    setDragNotice(null);
    if (placement.lane === "rejected" && !placement.confirmed) {
      rejectionFocusRequestRef.current = requestId;
      setPendingReject({ requestId, placement });
      return;
    }
    submitPlacement(requestId, placement);
  }

  function submitPlacement(requestId: number, placement: QueueDropInput) {
    const operation = beginLocalMutation({ kind: "placement", requestId, placement }, requestId);
    beginCanonicalRequest();
    setPlacementBusy(true);
    setError(null); setErrorSource(null);
    scheduleMutation(async () => {
      try {
        if (!canRunMutationTask()) { discardOptimisticOperation(operation.id); return; }
        const result = await placeDashboardEventQueueRequest(organizationId, eventId, requestId, placement);
        confirmOptimisticOperation(operation.id, result.request, result.items);
        if (mountedRef.current) setDragNotice("Zmiana kolejki zapisana.");
      } catch (caughtError) {
        await handleMutationError(caughtError, operation.id);
      } finally {
        if (mountedRef.current) setPlacementBusy(false);
      }
    });
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
    const activeDuplicate = isQueueAdmissionConflictError(caughtError);

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
    canonicalItems?: DashboardEventQueueItemDto[],
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
        baseItems: canonicalItems ?? reconcileDashboardEventQueueItem(
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
    return mutationAllowedByPropsRef.current && !queueClosedRef.current && !fairQueueBusyRef.current;
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
            {tx("Kolejka operacyjna")}</h2>
          <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">
            {tx("Zgłoszenia tego wydarzenia. Zmiany są widoczne od razu, a zapis odbywa się kolejno w tle.")}</p>
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
            {tx(formatLiveStatus(liveStatus))}
          </Badge>
          <Badge variant="secondary">
            {tx("Kolejka publiczna: ")}{publicQueueEnabled ? tx("włączona") : tx("wyłączona")}
          </Badge>
          <Badge variant="outline">
            {canMutate ? tx("Możesz zarządzać") : canManage ? tx("Zmiany niedostępne") : tx("Tylko podgląd")}
          </Badge>
          {isSyncing ? (
            <Badge variant="secondary" role="status">
              {tx("Synchronizacja…")}</Badge>
          ) : null}
          {pendingMutationCount > 0 ? (
            <Badge variant="secondary" role="status">
              {tx("Trwa zapis…")}</Badge>
          ) : null}
          {errorSource === "refresh" ? (
            <Badge variant="destructive" role="status">
              {tx("Błąd synchronizacji")}</Badge>
          ) : null}
          {canManage ? <FairQueueControl
            organizationId={organizationId}
            eventId={eventId}
            disabled={lifecycle !== "active" || queueClosedDetected || pendingMutationCount > 0 || isRefreshing || dragActive || !!pendingReject || placementBusy}
            onBusyChange={busy => {
              fairQueueBusyRef.current = busy;
              setFairQueueBusy(busy);
              if (busy) {
                localMutationVersionRef.current += 1;
                beginCanonicalRequest();
              } else {
                realtimeRefreshQueuedRef.current = true;
                flushQueuedRealtimeRefresh();
              }
            }}
            onApplied={canonicalItems => {
              if (mountedRef.current) replaceQueueBase(canonicalItems);
            }}
          /> : null}
          <Button
            variant="outline"
            type="button"
            onClick={() => void refreshQueue()}
            disabled={isRefreshing || fairQueueBusy || dragActive || placementBusy}
          >
            <RefreshCw
              aria-hidden="true"
              className={isRefreshing ? "animate-spin" : undefined}
              data-icon="inline-start"
            />
            {isRefreshing ? tx("Odświeżanie…") : tx("Odśwież")}
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
            {lifecycle !== "active" || queueClosedDetected ? tx("Kolejka jest zamknięta") : tx("Tryb tylko do odczytu")}
          </AlertTitle>
          <AlertDescription>
            {!canManage ? (
              <>
                {tx("Rola viewer pozwala przeglądać kolejkę, ale nie zmieniać statusów zgłoszeń ani ich kolejności.")}{lifecycle !== "active" || queueClosedDetected ? ` ${tx(getClosedQueueDescription(lifecycle, queueClosedDetected))}` : null}
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
            {errorSource === "mutation" ? tx("Nie udało się zapisać zmiany") : tx("Nie udało się zsynchronizować kolejki")}
          </AlertTitle>
          <AlertDescription>{tx(error)}</AlertDescription>
        </Alert>
      ) : null}

      {items.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-border px-4 py-6 text-center"
          data-queue-empty
        >
          <p className="text-sm font-semibold">{tx("Brak zgłoszeń")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tx("Nowe zgłoszenia z linku sesji pojawią się tutaj.")}</p>
        </div>
      ) : null}

      <section
        className="grid gap-3 border-b border-border pb-5"
        aria-labelledby="current-performance-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="current-performance-heading" className="text-base font-semibold">
              {tx("Aktualnie śpiewane")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {tx("Jedno bieżące zgłoszenie w wydarzeniu.")}</p>
          </div>
          <Badge variant={currentItem ? "default" : "secondary"}>
            {currentItem ? tx("Występ trwa") : tx("Scena wolna")}
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
            {tx("Żadne zgłoszenie nie jest teraz oznaczone jako śpiewane.")}</CardDescription>
        )}
      </section>

      {dragNotice ? <QueueDragNotice>{tx(dragNotice)}</QueueDragNotice> : null}
      <QueueDragBoard
        generation={dragEpoch}
        id={`event-queue:${organizationId}:${eventId}`}
        items={items}
        canDrag={canMutate && pendingMutationCount === 0 && !isRefreshing}
        onDraggingChange={(active, requestId) => {
          dragActiveRef.current = active; setDragActive(active);
          if (!active) setIsSyncing(false);
          if (active) {
            setDragNotice(null);
            focusRequestIdRef.current = null;
            if (focusAnimationFrameRef.current !== null) {
              window.cancelAnimationFrame(focusAnimationFrameRef.current);
              focusAnimationFrameRef.current = null;
            }
          }
          if (!active && requestId !== undefined) scheduleQueueRequestFocus(requestId);
        }}
        onDrop={(requestId, placement) => {
          if (dragEpoch === dragEpochRef.current) handlePlacement(requestId, placement);
        }}
        renderRow={(item, dragHandle, overlay) => <EventQueueRequestRow
          item={item} isDragOverlay={overlay} dragHandle={dragHandle}
          canManage={canMutate && !overlay}
          canMoveUp={approvedItems.findIndex(row => row.id === item.id) > 0}
          canMoveDown={item.status === "approved" && approvedItems.findIndex(row => row.id === item.id) < approvedItems.length - 1}
          onAction={handleAction} onMove={handleMove}
        />}
      />
      <AlertDialog open={pendingReject !== null} onOpenChange={open => { if (!open) setPendingReject(null); }}>
        <AlertDialogContent onCloseAutoFocus={event => {
          const requestId = rejectionFocusRequestRef.current;
          if (requestId !== null) {
            event.preventDefault();
            rejectionFocusRequestRef.current = null;
            scheduleQueueRequestFocus(requestId);
          }
        }}>
          <AlertDialogHeader><AlertDialogTitle>{tx("Odrzucić zgłoszenie?")}</AlertDialogTitle>
            <AlertDialogDescription>{tx("Zgłoszenie trafi do odrzuconych. Zmiana nastąpi dopiero po potwierdzeniu.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{tx("Anuluj")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              if (pendingReject) submitPlacement(pendingReject.requestId, { ...pendingReject.placement, confirmed: true });
              setPendingReject(null);
            }}>{tx("Odrzuć zgłoszenie")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section
        className="grid gap-3 border-t border-border pt-5"
        aria-labelledby="queue-history-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="queue-history-heading" className="text-base font-semibold">
              {tx("Historia")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {tx("Zagrane i pominięte zgłoszenia.")}</p>
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
            {tx("Historia jest jeszcze pusta.")}</CardDescription>
        )}
      </section>
    </section>
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
  const tx = useUiText();
  const actionLabels = localizeUiRecord(getI18nRecord_actionLabels(), tx);

  const actions = getAvailableActions(item.status);
  const duration = formatDuration(item.song.durationSeconds);
  const requestLabel = getQueueRequestLabel(item);

  return (
    <article
      aria-label={tx("Zgłoszenie: {v0}", {v0: requestLabel})}
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
            {item.requestedBy === "public" ? tx("Link sesji") : tx("Operator")}
          </Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className={"m-0 text-sm font-semibold leading-snug"}>{item.song.title}</p>
        </div>
        <p className={"mt-0.5 text-sm leading-snug text-muted-foreground"}>{item.song.artist}</p>
        {item.note ? <p className={"mt-2 text-sm leading-relaxed text-muted-foreground"}>{tx("Notatka: ")}{item.note}</p> : null}
      </div>

      <div className="flex flex-row flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground sm:flex-col sm:items-end sm:gap-1 sm:whitespace-nowrap">
        <span>
          {tx("Pozycja: ")}{item.status === "approved" ? item.position : "—"}
        </span>
        <span>{tx("Zgłoszono: ")}{tx.date(item.createdAt)}</span>
        {getQueueActivityTimestamp(item, tx.date) ? (
          <span>{tx(getQueueActivityTimestamp(item, tx.date))}</span>
        ) : null}
        {duration ? <span>{tx("Czas: ")}{duration}</span> : null}
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
                title={tx("Przesuń w górę")}
                aria-label={tx("Przesuń zgłoszenie w górę: {v0}", {v0: requestLabel})}
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
                title={tx("Przesuń w dół")}
                aria-label={tx("Przesuń zgłoszenie w dół: {v0}", {v0: requestLabel})}
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
                      aria-label={`${tx(actionLabels[action])}: ${getQueueRequestLabel(item)}`}
                    >
                      {getActionIcon(action)}
                      {actionLabels[action]}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent data-management-theme="true">
                    <AlertDialogHeader>
                      <AlertDialogTitle>{tx("Odrzucić zgłoszenie?")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {tx("Zgłoszenie zniknie z aktywnej kolejki. Można je później przywrócić.")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{tx("Anuluj")}</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        className={`${destructiveButtonClassName} min-h-11 sm:min-h-7`}
                        aria-label={`${tx(actionLabels[action])}: ${getQueueRequestLabel(item)}`}
                        onClick={(event) =>
                          void onAction(item.id, action, event.detail === 0)
                        }
                      >
                        {tx("Odrzuć zgłoszenie")}</AlertDialogAction>
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
                aria-label={`${tx(actionLabels[action])}: ${getQueueRequestLabel(item)}`}
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

function getQueueRequestLabel(item: DashboardEventQueueItemDto) {
  return `${item.displayName || item.singerName} — ${item.song.title}`;
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

function getQueueActivityTimestamp(item: DashboardEventQueueItemDto, format = formatDateTime) {
  if (item.completedAt) {
    return `Zakończono: ${format(item.completedAt)}`;
  }

  if (item.startedAt) {
    return `Rozpoczęto: ${format(item.startedAt)}`;
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
    case "QUEUE_PLACEMENT_STALE":
      return "Kolejka została zmieniona przez innego operatora. Sprawdź aktualną kolejność i przeciągnij ponownie.";
    case "QUEUE_ACTION_CONFLICT":
      return "Zgłoszenie zostało w międzyczasie zmienione. Odśwież kolejkę.";
    case "QUEUE_ACTIVE_DUPLICATE":
      return "Ta osoba ma już aktywne zgłoszenie tej piosenki.";
    case "SESSION_REQUEST_LIMIT_REACHED":
      return "Ta osoba ma już 2 aktywne zgłoszenia. Zakończ, odrzuć lub anuluj jedno z nich przed przywróceniem kolejnego.";
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

function isQueueAdmissionConflictError(error: unknown) {
  return (
    error instanceof OperatorClientError &&
    (error.code === "QUEUE_ACTIVE_DUPLICATE" || error.code === "SESSION_REQUEST_LIMIT_REACHED")
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
    case "placement": {
      const current = items.find(row => row.id === operation.requestId);
      let next = items;
      if (current?.status !== operation.placement.lane) {
        next = applyOptimisticDashboardEventQueueAction(items, operation.requestId,
          operation.placement.lane === "approved" ? "approve" : operation.placement.lane === "pending" ? "restore" : "reject", operation.changedAt);
      }
      return operation.placement.lane === "approved"
        ? applyOptimisticDashboardEventQueueMoveToPosition(next, operation.requestId, operation.placement.position, operation.changedAt) : next;
    }
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

  }
}

function getI18nRecord_actionLabels() { return actionLabels; }
