import { getEffectiveEventLifecycleStatus } from "./effective-event-lifecycle.ts";

export type EventPhase = "upcoming" | "live" | "ended" | "cancelled";

export type EventPhaseInput = {
  status: string;
  startsAt: Date;
  autoCloseAt?: Date | null;
  endsAt: Date;
  closedAt: Date | null;
};

export function getEventPhase(
  event: EventPhaseInput,
  referenceNow = new Date(),
): EventPhase {
  const status = getEffectiveEventLifecycleStatus(event, referenceNow);

  if (status === "scheduled") return "upcoming";
  if (status === "active") return "live";
  if (status === "cancelled") return "cancelled";
  return "ended";
}
