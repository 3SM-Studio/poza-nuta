import {
  getDashboardEventQueueTargetStatus,
  type DashboardEventQueueAction,
  type DashboardEventQueueMoveDirection,
  type DashboardEventQueueRequestStatus,
} from "./dashboard-event-queue.ts";

export type DashboardEventQueueOptimisticItem = {
  id: number;
  status: DashboardEventQueueRequestStatus;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export function getDashboardEventQueueActionOperationKey(
  requestId: number,
  action: DashboardEventQueueAction,
) {
  return `${requestId}:${action}`;
}

export function getDashboardEventQueueMoveOperationKey(
  requestId: number,
  direction: DashboardEventQueueMoveDirection,
) {
  return `${requestId}:move:${direction}`;
}

export function isDashboardEventQueueRequestPending(
  pendingOperations: ReadonlySet<string>,
  requestId: number,
) {
  const requestPrefix = `${requestId}:`;

  for (const operation of pendingOperations) {
    if (operation.startsWith(requestPrefix)) {
      return true;
    }
  }

  return false;
}

export function applyOptimisticDashboardEventQueueAction<
  TItem extends DashboardEventQueueOptimisticItem,
>(
  items: TItem[],
  requestId: number,
  action: DashboardEventQueueAction,
  changedAt = new Date().toISOString(),
) {
  if (!items.some((item) => item.id === requestId)) {
    return items;
  }

  const targetStatus = getDashboardEventQueueTargetStatus(action);
  const nextApprovedPosition =
    Math.max(
      0,
      ...items
        .filter((item) => item.status === "approved")
        .map((item) => item.position),
    ) + 1;
  const optimisticItems = items.map((item) => {
    if (action === "start" && item.status === "now" && item.id !== requestId) {
      return patchQueueItem(item, {
        status: "done",
        position: 0,
        completedAt: changedAt,
        updatedAt: changedAt,
        version: item.version + 1,
      });
    }

    if (item.id !== requestId) {
      return item;
    }

    switch (action) {
      case "approve":
        return patchQueueItem(item, {
          status: targetStatus,
          position: nextApprovedPosition,
          updatedAt: changedAt,
          version: item.version + 1,
        });
      case "start":
        return patchQueueItem(item, {
          status: targetStatus,
          position: 0,
          startedAt: changedAt,
          completedAt: null,
          updatedAt: changedAt,
          version: item.version + 1,
        });
      case "reject":
        return patchQueueItem(item, {
          status: targetStatus,
          position: 0,
          updatedAt: changedAt,
          version: item.version + 1,
        });
      case "done":
        return patchQueueItem(item, {
          status: targetStatus,
          position: 0,
          completedAt: changedAt,
          updatedAt: changedAt,
          version: item.version + 1,
        });
      case "restore":
        return patchQueueItem(item, {
          status: targetStatus,
          position: 0,
          startedAt: null,
          completedAt: null,
          updatedAt: changedAt,
          version: item.version + 1,
        });
    }
  });

  return sortDashboardEventQueueOptimisticItems(
    renumberApprovedQueue(optimisticItems, changedAt),
  );
}

export function applyOptimisticDashboardEventQueueMove<
  TItem extends DashboardEventQueueOptimisticItem,
>(
  items: TItem[],
  requestId: number,
  direction: DashboardEventQueueMoveDirection,
  changedAt = new Date().toISOString(),
) {
  const approvedItems = items
    .filter((item) => item.status === "approved")
    .sort(compareApprovedQueueItems);
  const currentIndex = approvedItems.findIndex((item) => item.id === requestId);

  if (currentIndex < 0) {
    return items;
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= approvedItems.length) {
    return items;
  }

  [approvedItems[currentIndex], approvedItems[targetIndex]] = [
    approvedItems[targetIndex],
    approvedItems[currentIndex],
  ];

  const positions = new Map(
    approvedItems.map((item, index) => [item.id, index + 1]),
  );

  return sortDashboardEventQueueOptimisticItems(
    items.map((item) => {
      const position = positions.get(item.id);

      if (!position || position === item.position) {
        return item;
      }

      return patchQueueItem(item, {
        position,
        updatedAt: changedAt,
        version: item.version + 1,
      });
    }),
  );
}

export function reconcileDashboardEventQueueItem<
  TItem extends DashboardEventQueueOptimisticItem,
>(items: TItem[], updatedItem: TItem) {
  let replaced = false;
  const nextItems = items.map((item) => {
    if (item.id !== updatedItem.id) {
      return item;
    }

    replaced = true;
    return updatedItem;
  });

  return sortDashboardEventQueueOptimisticItems(
    replaced ? nextItems : [...nextItems, updatedItem],
  );
}

export function restoreDashboardEventQueueItems<
  TItem extends DashboardEventQueueOptimisticItem,
>(items: TItem[], rollbackItems: TItem[]) {
  if (rollbackItems.length === 0) {
    return items;
  }

  const rollbackItemsById = new Map(
    rollbackItems.map((item) => [item.id, item]),
  );

  return sortDashboardEventQueueOptimisticItems(
    items.map((item) => rollbackItemsById.get(item.id) ?? item),
  );
}

export function getDashboardEventQueueChangedRequestIds<
  TItem extends DashboardEventQueueOptimisticItem,
>(previousItems: TItem[], nextItems: TItem[]) {
  const previousItemsById = new Map(
    previousItems.map((item) => [item.id, item]),
  );

  return nextItems
    .filter((item) => {
      const previousItem = previousItemsById.get(item.id);

      return previousItem ? hasQueueItemChanged(previousItem, item) : true;
    })
    .map((item) => item.id);
}

function renumberApprovedQueue<TItem extends DashboardEventQueueOptimisticItem>(
  items: TItem[],
  changedAt: string,
) {
  const positions = new Map(
    items
      .filter((item) => item.status === "approved")
      .sort(compareApprovedQueueItems)
      .map((item, index) => [item.id, index + 1]),
  );

  return items.map((item) => {
    const position = positions.get(item.id);

    if (!position || position === item.position) {
      return item;
    }

    return patchQueueItem(item, {
      position,
      updatedAt: changedAt,
      version: item.version + 1,
    });
  });
}

function sortDashboardEventQueueOptimisticItems<
  TItem extends DashboardEventQueueOptimisticItem,
>(items: TItem[]) {
  return [...items].sort(compareDashboardQueueItems);
}

function compareDashboardQueueItems(
  left: DashboardEventQueueOptimisticItem,
  right: DashboardEventQueueOptimisticItem,
) {
  const statusRank = {
    now: 0,
    pending: 1,
    approved: 2,
    rejected: 3,
    done: 4,
    skipped: 5,
  } as const;
  const rankDifference = statusRank[left.status] - statusRank[right.status];

  if (rankDifference !== 0) {
    return rankDifference;
  }

  if (left.status === "approved") {
    return left.position - right.position || left.id - right.id;
  }

  if (
    left.status === "done" ||
    left.status === "skipped" ||
    left.status === "rejected"
  ) {
    return (
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      right.id - left.id
    );
  }

  return (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.id - right.id
  );
}

function compareApprovedQueueItems(
  left: DashboardEventQueueOptimisticItem,
  right: DashboardEventQueueOptimisticItem,
) {
  return (
    left.position - right.position ||
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.id - right.id
  );
}

function patchQueueItem<TItem extends DashboardEventQueueOptimisticItem>(
  item: TItem,
  patch: Partial<DashboardEventQueueOptimisticItem>,
) {
  return {
    ...item,
    ...patch,
  } as TItem;
}

function hasQueueItemChanged(
  previousItem: DashboardEventQueueOptimisticItem,
  nextItem: DashboardEventQueueOptimisticItem,
) {
  return (
    previousItem.status !== nextItem.status ||
    previousItem.position !== nextItem.position ||
    previousItem.version !== nextItem.version ||
    previousItem.updatedAt !== nextItem.updatedAt ||
    previousItem.startedAt !== nextItem.startedAt ||
    previousItem.completedAt !== nextItem.completedAt
  );
}
