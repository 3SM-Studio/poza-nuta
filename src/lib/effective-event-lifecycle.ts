export type EffectiveEventLifecycleStatus =
  | "scheduled"
  | "active"
  | "closed"
  | "cancelled";

export type EffectiveEventLifecycleInput = {
  status: string;
  startsAt: Date;
  autoCloseAt?: Date | null;
  endsAt: Date;
  closedAt: Date | null;
};

export function getEffectiveEventLifecycleStatus(
  event: EffectiveEventLifecycleInput,
  now = new Date(),
): EffectiveEventLifecycleStatus {
  if (event.status === "cancelled") {
    return "cancelled";
  }

  if (event.status === "closed" || event.closedAt) {
    return "closed";
  }

  if (now.getTime() < event.startsAt.getTime()) {
    return "scheduled";
  }

  const closesAt = event.autoCloseAt ?? event.endsAt;

  return now.getTime() < closesAt.getTime() ? "active" : "closed";
}

export function isEffectiveEventActive(
  event: EffectiveEventLifecycleInput,
  now = new Date(),
) {
  return getEffectiveEventLifecycleStatus(event, now) === "active";
}
