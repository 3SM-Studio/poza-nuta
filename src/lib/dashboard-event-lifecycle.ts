import {
  getEffectiveEventLifecycleStatus,
  type EffectiveEventLifecycleStatus,
} from "./effective-event-lifecycle.ts";

export const DASHBOARD_EVENT_CLOSING_WARNING_MINUTES = 30;
export const DASHBOARD_EVENT_EXTENSION_MINUTES = [20, 30, 60] as const;
const ACTIVE_PUBLIC_EVENT_INDEX_NAME =
  "events_one_active_public_per_workspace_idx";
const UNIQUE_VIOLATION_CODE = "23505";
const MAX_ERROR_CAUSE_DEPTH = 5;

export type DashboardEventExtensionMinutes =
  (typeof DASHBOARD_EVENT_EXTENSION_MINUTES)[number];

export type DashboardEventLifecycleStatus = EffectiveEventLifecycleStatus;

export type DashboardEventLifecycleInput = {
  status: string;
  startsAt: Date;
  autoCloseAt: Date | null;
  endsAt?: Date;
  closedAt: Date | null;
};

export function getDashboardEventLifecycleStatus(
  event: DashboardEventLifecycleInput,
  now = new Date(),
): DashboardEventLifecycleStatus {
  return getEffectiveEventLifecycleStatus(
    {
      ...event,
      endsAt: event.endsAt ?? event.autoCloseAt ?? event.startsAt,
    },
    now,
  );
}

export function areDashboardEventRequestsOpen(
  event: DashboardEventLifecycleInput,
  now = new Date(),
) {
  return getDashboardEventLifecycleStatus(event, now) === "active";
}

export function canManageDashboardEventLifecycle(
  event: DashboardEventLifecycleInput,
  now = new Date(),
) {
  const status = getDashboardEventLifecycleStatus(event, now);

  return status === "scheduled" || status === "active";
}

export function shouldShowDashboardEventClosingWarning(
  event: DashboardEventLifecycleInput,
  now = new Date(),
) {
  if (getDashboardEventLifecycleStatus(event, now) !== "active") {
    return false;
  }

  if (!event.autoCloseAt) {
    return false;
  }

  const remainingMs = event.autoCloseAt.getTime() - now.getTime();

  return (
    remainingMs > 0 &&
    remainingMs <= DASHBOARD_EVENT_CLOSING_WARNING_MINUTES * 60 * 1_000
  );
}

export function calculateDashboardEventExtendedAutoCloseAt({
  autoCloseAt,
  minutes,
  now = new Date(),
}: {
  autoCloseAt: Date | null;
  minutes: DashboardEventExtensionMinutes;
  now?: Date;
}) {
  const baseTime = Math.max(now.getTime(), autoCloseAt?.getTime() ?? 0);

  return new Date(baseTime + minutes * 60 * 1_000);
}

export function resolveDashboardEventCloseAt({
  autoCloseAt,
  minutes,
  closesAt,
  now = new Date(),
}: {
  autoCloseAt: Date | null;
  minutes: DashboardEventExtensionMinutes | null;
  closesAt: Date | null;
  now?: Date;
}) {
  if (closesAt) return closesAt;
  if (minutes === null) throw new Error("Event close time is required.");

  return calculateDashboardEventExtendedAutoCloseAt({
    autoCloseAt,
    minutes,
    now,
  });
}

export function isActivePublicEventUniqueViolation(error: unknown) {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (!isRecord(current) || seen.has(current)) return false;
    seen.add(current);

    const constraint =
      typeof current.constraint === "string"
        ? current.constraint
        : typeof current.constraint_name === "string"
          ? current.constraint_name
          : null;

    if (
      current.code === UNIQUE_VIOLATION_CODE &&
      constraint === ACTIVE_PUBLIC_EVENT_INDEX_NAME
    ) {
      return true;
    }

    current = current.cause;
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
