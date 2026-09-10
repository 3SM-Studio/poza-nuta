import { getEffectiveEventLifecycleStatus } from "./effective-event-lifecycle.ts";

export const EVENT_REOPEN_GRACE_MINUTES = 20;
export const EVENT_REOPEN_GRACE_MS = EVENT_REOPEN_GRACE_MINUTES * 60 * 1_000;

export type EventSessionLifecycleInput = {
  status: string;
  startsAt: Date;
  autoCloseAt: Date | null;
  endsAt: Date;
  closedAt: Date | null;
  closeReason?: string | null;
};

export function getEffectiveEventCloseInstant(
  event: EventSessionLifecycleInput,
): Date | null {
  if (event.status === "cancelled") return event.closedAt ?? event.endsAt;

  if (event.closeReason === "manual" && event.closedAt) {
    return event.closedAt;
  }

  if (event.autoCloseAt) return event.autoCloseAt;
  if (event.closedAt) return event.closedAt;
  return event.endsAt;
}

export function canResolveEventJoinCode(
  event: EventSessionLifecycleInput,
  now = new Date(),
) {
  if (event.status === "cancelled") return false;

  const lifecycle = getEffectiveEventLifecycleStatus(event, now);
  if (lifecycle !== "closed") return true;

  const closedAt = getEffectiveEventCloseInstant(event);
  return closedAt !== null && now.getTime() < closedAt.getTime() + EVENT_REOPEN_GRACE_MS;
}

export function canReopenEvent(
  event: EventSessionLifecycleInput,
  now = new Date(),
) {
  if (event.status === "cancelled") return false;
  if (getEffectiveEventLifecycleStatus(event, now) !== "closed") return false;

  const closedAt = getEffectiveEventCloseInstant(event);
  return closedAt !== null && now.getTime() < closedAt.getTime() + EVENT_REOPEN_GRACE_MS;
}

export function getEventReopenDeadline(event: EventSessionLifecycleInput) {
  const closedAt = getEffectiveEventCloseInstant(event);
  return closedAt ? new Date(closedAt.getTime() + EVENT_REOPEN_GRACE_MS) : null;
}
