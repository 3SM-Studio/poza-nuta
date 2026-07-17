import { getEffectiveEventLifecycleStatus } from "./effective-event-lifecycle.ts";
import { isCanonicalSessionCode } from "./session-code.ts";

export type SessionEventAccessStatus =
  | "invalid"
  | "scheduled"
  | "closed"
  | "active";

export type SessionEventAccessEventInput = {
  status: string;
  startsAt: Date;
  autoCloseAt: Date | null;
  endsAt: Date;
  closedAt: Date | null;
} | null;

export function isValidSessionCodeFormat(code: string) {
  return isCanonicalSessionCode(code);
}

export function getSessionEventAccessStatus({
  event,
  now = new Date(),
}: {
  event: SessionEventAccessEventInput;
  now?: Date;
}): SessionEventAccessStatus {
  if (!event) {
    return "invalid";
  }

  const phase = getEffectiveEventLifecycleStatus(event, now);

  if (phase === "cancelled" || phase === "closed") {
    return "closed";
  }

  if (phase === "scheduled") {
    return "scheduled";
  }

  return "active";
}
