export type EventPhase = "upcoming" | "live" | "ended" | "cancelled";

export type EventPhaseInput = {
  status: string;
  startsAt: Date;
  endsAt: Date;
  closedAt: Date | null;
};

export function getEventPhase(
  event: EventPhaseInput,
  referenceNow = new Date(),
): EventPhase {
  if (event.status === "cancelled") {
    return "cancelled";
  }

  if (event.closedAt || event.status === "closed") {
    return "ended";
  }

  if (referenceNow.getTime() < event.startsAt.getTime()) {
    return "upcoming";
  }

  if (referenceNow.getTime() < event.endsAt.getTime()) {
    return "live";
  }

  return "ended";
}
