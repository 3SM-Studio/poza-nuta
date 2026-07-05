export const DASHBOARD_EVENT_QUEUE_FILTERS = [
  "all",
  "pending",
  "approved",
  "rejected",
  "closed",
] as const;

export const DASHBOARD_EVENT_QUEUE_ACTIONS = [
  "approve",
  "start",
  "reject",
  "done",
  "restore",
] as const;

export const DASHBOARD_EVENT_QUEUE_MOVE_DIRECTIONS = ["up", "down"] as const;

export type DashboardEventQueueFilter =
  (typeof DASHBOARD_EVENT_QUEUE_FILTERS)[number];
export type DashboardEventQueueAction =
  (typeof DASHBOARD_EVENT_QUEUE_ACTIONS)[number];
export type DashboardEventQueueMoveDirection =
  (typeof DASHBOARD_EVENT_QUEUE_MOVE_DIRECTIONS)[number];
export type DashboardEventQueueRole =
  | "owner"
  | "manager"
  | "operator"
  | "viewer";
export type DashboardEventQueueRequestStatus =
  | "pending"
  | "approved"
  | "now"
  | "done"
  | "skipped"
  | "rejected";

const allowedSourceStatuses: Record<
  DashboardEventQueueAction,
  readonly DashboardEventQueueRequestStatus[]
> = {
  approve: ["pending"],
  start: ["pending", "approved"],
  reject: ["pending", "approved"],
  done: ["approved", "now"],
  restore: ["approved", "done", "skipped", "rejected"],
};

const targetStatuses: Record<
  DashboardEventQueueAction,
  DashboardEventQueueRequestStatus
> = {
  approve: "approved",
  start: "now",
  reject: "rejected",
  done: "done",
  restore: "pending",
};

const filterStatuses: Record<
  Exclude<DashboardEventQueueFilter, "all">,
  readonly DashboardEventQueueRequestStatus[]
> = {
  pending: ["pending"],
  approved: ["approved"],
  rejected: ["rejected"],
  closed: ["done", "skipped"],
};

export function canManageDashboardEventQueue(role: DashboardEventQueueRole) {
  return role === "owner" || role === "manager" || role === "operator";
}

export function canApplyDashboardEventQueueAction(
  action: DashboardEventQueueAction,
  currentStatus: DashboardEventQueueRequestStatus,
) {
  return allowedSourceStatuses[action].includes(currentStatus);
}

export function getDashboardEventQueueTargetStatus(
  action: DashboardEventQueueAction,
) {
  return targetStatuses[action];
}

export function getDashboardEventQueueFilterStatuses(
  filter: DashboardEventQueueFilter,
) {
  return filter === "all" ? null : filterStatuses[filter];
}

export function canReorderDashboardEventQueueRequest(
  status: DashboardEventQueueRequestStatus,
) {
  return status === "approved";
}
