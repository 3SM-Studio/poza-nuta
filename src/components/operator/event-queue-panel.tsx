"use client";

import { useCallback, useMemo, useState } from "react";
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
import { useRouter } from "next/navigation";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { QueueRealtimeConnectionStatus } from "@/lib/queue-realtime";
import { formatWarsawDateTime } from "@/lib/warsaw-time";

import { formatDuration, OperatorClientError } from "./api";
import {
  getDashboardEventQueue,
  moveDashboardEventQueueRequest,
  runDashboardEventQueueAction,
  type DashboardEventQueueItemDto,
} from "./event-queue-api";
import styles from "./operator.module.css";
import { useDashboardQueueRealtime } from "./use-dashboard-queue-realtime";

const filterLabels: Record<DashboardEventQueueFilter, string> = {
  all: "Wszystkie",
  pending: "Oczekujące",
  approved: "Zaakceptowane",
  rejected: "Odrzucone",
  closed: "Zagrane / zamknięte",
};

const statusLabels: Record<DashboardEventQueueRequestStatus, string> = {
  pending: "Oczekujące",
  approved: "Zaakceptowane",
  now: "W trakcie",
  done: "Zagrane",
  skipped: "Zamknięte",
  rejected: "Odrzucone",
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
  eventId: number;
  canManage: boolean;
  initialItems: DashboardEventQueueItemDto[];
};

export function EventQueuePanel({
  organizationId,
  eventId,
  canManage,
  initialItems,
}: EventQueuePanelProps) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [activeFilter, setActiveFilter] =
    useState<DashboardEventQueueFilter>("all");
  const [pendingOperations, setPendingOperations] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const refreshFromRealtime = useCallback(
    async (_reason: unknown, signal: AbortSignal) => {
      setIsSyncing(true);

      try {
        const response = await getDashboardEventQueue(
          organizationId,
          eventId,
          signal,
        );

        setItems(response.items);
        setMessage("Kolejka zaktualizowana.");
        setError(null);
      } catch (caughtError) {
        if (signal.aborted || isAbortError(caughtError)) {
          return;
        }

        if (
          caughtError instanceof OperatorClientError &&
          caughtError.status === 401
        ) {
          router.replace("/sign-in");
          router.refresh();
          return;
        }

        setError(getClientErrorMessage(caughtError));
      } finally {
        setIsSyncing(false);
      }
    },
    [eventId, organizationId, router],
  );
  const liveStatus = useDashboardQueueRealtime(
    eventId,
    refreshFromRealtime,
  );

  async function refreshQueue() {
    setIsRefreshing(true);
    setError(null);

    try {
      const response = await getDashboardEventQueue(organizationId, eventId);

      setItems(response.items);
      setMessage("Kolejka zaktualizowana.");
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        setError(getClientErrorMessage(caughtError));
      }
    } finally {
      setIsRefreshing(false);
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

    markOperationPending(operationKey);
    setItems(optimisticItems);
    setMessage(null);
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
      setMessage(`Zmieniono status. ${actionSuccessMessages[action]}`);
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        setItems((currentItems) =>
          restoreDashboardEventQueueItems(currentItems, rollbackItems),
        );
        setError(getClientErrorMessage(caughtError));
      }
    } finally {
      clearOperationPending(operationKey);
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

    markOperationPending(operationKey);
    setItems(optimisticItems);
    setMessage(null);
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
      setMessage(
        !result.moved
          ? "Zgłoszenie jest już na skraju kolejki."
          : "Kolejność zgłoszeń została zmieniona.",
      );
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        setItems((currentItems) =>
          restoreDashboardEventQueueItems(currentItems, rollbackItems),
        );
        setError(getClientErrorMessage(caughtError));
      }
    } finally {
      clearOperationPending(operationKey);
    }
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
      router.replace("/sign-in");
      router.refresh();
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
          <div className={styles.eventQueueLiveActions}>
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

      <CardContent className={styles.eventQueueContent}>
        {!canManage ? (
          <Alert>
            <AlertTitle>Tryb tylko do odczytu</AlertTitle>
            <AlertDescription>
              Rola viewer pozwala przeglądać kolejkę, ale nie zmieniać statusów
              zgłoszeń ani ich kolejności.
            </AlertDescription>
          </Alert>
        ) : null}

        {message ? (
          <Alert role="status">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Nie udało się zapisać zmiany</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section className={styles.eventQueueCurrent}>
          <div>
            <h3>Aktualnie śpiewane</h3>
            <p className={styles.eventMeta}>
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

        <div className={styles.eventQueueFilters}>
          <Select
            value={activeFilter}
            onValueChange={(value) =>
              setActiveFilter(value as DashboardEventQueueFilter)
            }
          >
            <SelectTrigger
              className={styles.eventQueueFilterSelect}
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
          <div className={styles.requestList}>
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
          <CardDescription className={styles.emptyPage}>
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
    <article className={styles.requestRow}>
      <div className={styles.requestMain}>
        <div className={styles.requestHeading}>
          <strong>{item.displayName || item.singerName}</strong>
          <Badge variant={getRequestStatusBadgeVariant(item.status)}>
            {statusLabels[item.status]}
          </Badge>
          <Badge variant="outline">
            {item.requestedBy === "public" ? "Link sesji" : "Operator"}
          </Badge>
        </div>
        <div className={styles.songHeading}>
          <p className={styles.songTitle}>{item.song.title}</p>
        </div>
        <p className={styles.songArtist}>{item.song.artist}</p>
        {item.note ? <p className={styles.note}>Notatka: {item.note}</p> : null}
      </div>

      <div className={styles.requestMeta}>
        <span>
          Pozycja: {item.status === "approved" ? item.position : "—"}
        </span>
        <span>{formatDateTime(item.createdAt)}</span>
        {duration ? <span>Czas: {duration}</span> : null}
      </div>

      {canManage && (actions.length > 0 || item.status === "approved") ? (
        <div className={styles.rowActions}>
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

            return (
              <Button
                key={action}
                size="sm"
                variant={action === "reject" ? "destructive" : "default"}
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

function getRequestStatusBadgeVariant(status: DashboardEventQueueRequestStatus) {
  if (status === "rejected") {
    return "destructive" as const;
  }

  if (status === "approved" || status === "now" || status === "done") {
    return "default" as const;
  }

  return "secondary" as const;
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
