"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleCheck,
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DASHBOARD_EVENT_QUEUE_FILTERS,
  canApplyDashboardEventQueueAction,
  getDashboardEventQueueFilterStatuses,
  type DashboardEventQueueAction,
  type DashboardEventQueueFilter,
  type DashboardEventQueueMoveDirection,
  type DashboardEventQueueRequestStatus,
} from "@/lib/dashboard-event-queue";
import {
  applyOptimisticDashboardEventQueueAction,
  applyOptimisticDashboardEventQueueMove,
  getDashboardEventQueueActionOperationKey,
  getDashboardEventQueueChangedRequestIds,
  getDashboardEventQueueMoveOperationKey,
  isDashboardEventQueueRequestPending,
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

const filterLabels: Record<DashboardEventQueueFilter, string> = {
  all: "Wszystkie",
  pending: "Oczekujące",
  approved: "Zaakceptowane",
  rejected: "Odrzucone",
  closed: "Zagrane / zamknięte",
};

const actionLabels: Record<DashboardEventQueueAction, string> = {
  approve: "Zaakceptuj",
  start: "Ustaw jako aktualnie śpiewane",
  reject: "Odrzuć",
  done: "Oznacz jako zagrane",
  restore: "Przywróć",
};

const actionSuccessMessages: Record<DashboardEventQueueAction, string> = {
  approve: "Zgłoszenie zostało zaakceptowane.",
  start: "Zgłoszenie ustawiono jako aktualnie śpiewane.",
  reject: "Zgłoszenie zostało odrzucone.",
  done: "Zgłoszenie oznaczono jako zagrane.",
  restore: "Zgłoszenie przywrócono do oczekujących.",
};

type EventQueuePanelProps = {
  organizationId: string;
  eventId: string;
  realtimeEventId: number;
  canManage: boolean;
  initialItems: DashboardEventQueueItemDto[];
};

export function EventQueuePanel({
  organizationId,
  eventId,
  realtimeEventId,
  canManage,
  initialItems,
}: EventQueuePanelProps) {
  const [items, setItems] = useState(initialItems);
  const [activeFilter, setActiveFilter] =
    useState<DashboardEventQueueFilter>("all");
  const [pendingOperations, setPendingOperations] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingMutationCountRef = useRef(0);
  const localMutationVersionRef = useRef(0);
  const realtimeRefreshInFlightRef = useRef(false);
  const realtimeRefreshQueuedRef = useRef(false);
  const refreshFromRealtimeRef = useRef<
    | ((
        reason: QueueRealtimeInvalidateReason,
        signal: AbortSignal,
      ) => Promise<void>)
    | null
  >(null);
  const filteredItems = useMemo(() => {
    const statuses = getDashboardEventQueueFilterStatuses(activeFilter);
    const queueItems = items.filter((item) => item.status !== "now");

    return statuses
      ? queueItems.filter((item) => statuses.includes(item.status))
      : queueItems;
  }, [activeFilter, items]);
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
      "broadcast",
      new AbortController().signal,
    );
  }, []);
  const refreshFromRealtime = useCallback(
    async (
      reason: QueueRealtimeInvalidateReason,
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
      const showSyncIndicator = reason !== "subscribe";
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

  async function handleAction(
    requestId: number,
    action: DashboardEventQueueAction,
  ) {
    const operationKey = getDashboardEventQueueActionOperationKey(
      requestId,
      action,
    );
    const previousItems = items;
    const optimisticItems = applyOptimisticDashboardEventQueueAction(
      previousItems,
      requestId,
      action,
    );
    const changedRequestIds = getDashboardEventQueueChangedRequestIds(
      previousItems,
      optimisticItems,
    );
    const rollbackItems = previousItems.filter((item) =>
      changedRequestIds.includes(item.id),
    );

    beginLocalMutation();
    markOperationPending(operationKey);
    setItems(optimisticItems);
    setError(null);

    try {
      const result = await runDashboardEventQueueAction(
        organizationId,
        eventId,
        requestId,
        action,
      );

      setItems((currentItems) =>
        reconcileDashboardEventQueueItem(currentItems, result.request),
      );
      toast.success("Zmieniono status", {
        description: actionSuccessMessages[action],
      });
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        setItems((currentItems) =>
          restoreDashboardEventQueueItems(currentItems, rollbackItems),
        );
        setError(getClientErrorMessage(caughtError));
      }
    } finally {
      clearOperationPending(operationKey);
      finishLocalMutation();
    }
  }

  async function handleMove(
    requestId: number,
    direction: DashboardEventQueueMoveDirection,
  ) {
    const operationKey = getDashboardEventQueueMoveOperationKey(
      requestId,
      direction,
    );
    const previousItems = items;
    const optimisticItems = applyOptimisticDashboardEventQueueMove(
      previousItems,
      requestId,
      direction,
    );
    const changedRequestIds = getDashboardEventQueueChangedRequestIds(
      previousItems,
      optimisticItems,
    );
    const rollbackItems = previousItems.filter((item) =>
      changedRequestIds.includes(item.id),
    );

    beginLocalMutation();
    markOperationPending(operationKey);
    setItems(optimisticItems);
    setError(null);

    try {
      const result = await moveDashboardEventQueueRequest(
        organizationId,
        eventId,
        requestId,
        direction,
      );

      setItems((currentItems) =>
        reconcileDashboardEventQueueItem(currentItems, result.request),
      );
      if (!result.moved) {
        toast.info("Zgłoszenie jest już na skraju kolejki");
      } else {
        toast.success("Kolejność zgłoszeń została zmieniona");
      }
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        setItems((currentItems) =>
          restoreDashboardEventQueueItems(currentItems, rollbackItems),
        );
        setError(getClientErrorMessage(caughtError));
      }
    } finally {
      clearOperationPending(operationKey);
      finishLocalMutation();
    }
  }

  function beginLocalMutation() {
    pendingMutationCountRef.current += 1;
    localMutationVersionRef.current += 1;
  }

  function finishLocalMutation() {
    pendingMutationCountRef.current = Math.max(
      0,
      pendingMutationCountRef.current - 1,
    );
    flushQueuedRealtimeRefresh();
  }

  function markOperationPending(operationKey: string) {
    setPendingOperations((currentOperations) => {
      const nextOperations = new Set(currentOperations);

      nextOperations.add(operationKey);
      return nextOperations;
    });
  }

  function clearOperationPending(operationKey: string) {
    setPendingOperations((currentOperations) => {
      const nextOperations = new Set(currentOperations);

      nextOperations.delete(operationKey);
      return nextOperations;
    });
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
          Zmiany są pobierane przez API po sygnale Supabase Realtime.
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
              disabled={isRefreshing || pendingOperations.size > 0}
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
              pendingOperations={pendingOperations}
              onAction={handleAction}
              onMove={handleMove}
            />
          ) : (
            <CardDescription>
              Żadne zgłoszenie nie jest teraz oznaczone jako śpiewane.
            </CardDescription>
          )}
        </section>

        <div className={"flex flex-wrap gap-2"}>
          <Select
            value={activeFilter}
            onValueChange={(value) =>
              setActiveFilter(value as DashboardEventQueueFilter)
            }
          >
            <SelectTrigger
              className={"w-full max-w-72"}
              aria-label="Filtr kolejki wydarzenia"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {DASHBOARD_EVENT_QUEUE_FILTERS.map((filter) => (
                  <SelectItem key={filter} value={filter}>
                    {filterLabels[filter]} ({getFilterCount(items, filter)})
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {filteredItems.length > 0 ? (
          <div className={"grid p-0"}>
            {filteredItems.map((item) => {
              const approvedIndex = approvedItems.findIndex(
                (approvedItem) => approvedItem.id === item.id,
              );

              return (
                <EventQueueRequestRow
                  key={item.id}
                  item={item}
                  canManage={canManage}
                  canMoveUp={approvedIndex > 0}
                  canMoveDown={
                    approvedIndex >= 0 &&
                    approvedIndex < approvedItems.length - 1
                  }
                  pendingOperations={pendingOperations}
                  onAction={handleAction}
                  onMove={handleMove}
                />
              );
            })}
          </div>
        ) : (
          <CardDescription className={"px-4 py-16 text-center text-muted-foreground"}>
            <strong>Brak zgłoszeń</strong>
            <br />
            Nie ma jeszcze zgłoszeń z linku sesji.
          </CardDescription>
        )}
      </CardContent>
    </Card>
  );
}

type EventQueueRequestRowProps = {
  item: DashboardEventQueueItemDto;
  canManage: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  pendingOperations: ReadonlySet<string>;
  onAction: (
    requestId: number,
    action: DashboardEventQueueAction,
  ) => Promise<void>;
  onMove: (
    requestId: number,
    direction: DashboardEventQueueMoveDirection,
  ) => Promise<void>;
};

function EventQueueRequestRow({
  item,
  canManage,
  canMoveUp,
  canMoveDown,
  pendingOperations,
  onAction,
  onMove,
}: EventQueueRequestRowProps) {
  const actions = getAvailableActions(item.status);
  const duration = formatDuration(item.song.durationSeconds);
  const isRequestPending = isDashboardEventQueueRequestPending(
    pendingOperations,
    item.id,
  );

  return (
    <article className={"grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-[minmax(12rem,1fr)_auto] [&+&]:border-t [&+&]:border-border"}>
      <div className={"min-w-0"}>
        <div className={"flex flex-wrap items-center gap-2 [&_strong]:text-base"}>
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
                disabled={isRequestPending || !canMoveUp}
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
                disabled={isRequestPending || !canMoveDown}
              >
                <ArrowDown aria-hidden="true" data-icon="inline-start" />
              </Button>
            </>
          ) : null}

          {actions.map((action) => {
            const operationKey = getDashboardEventQueueActionOperationKey(
              item.id,
              action,
            );
            const isCurrentActionPending = pendingOperations.has(operationKey);

            if (action === "reject") {
              return (
                <AlertDialog key={action}>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="destructive"
                      type="button"
                      disabled={isRequestPending}
                    >
                      {getActionIcon(action)}
                      {isCurrentActionPending
                        ? "Zapisywanie..."
                        : actionLabels[action]}
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
                disabled={isRequestPending}
              >
                {getActionIcon(action)}
                {isCurrentActionPending
                  ? "Zapisywanie..."
                  : actionLabels[action]}
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

function getFilterCount(
  items: DashboardEventQueueItemDto[],
  filter: DashboardEventQueueFilter,
) {
  const statuses = getDashboardEventQueueFilterStatuses(filter);

  return statuses
    ? items.filter((item) => statuses.includes(item.status)).length
    : items.length;
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
