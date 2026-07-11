import { getEventPhase } from "./event-phase.ts";

export const SESSION_CODE_MIN_LENGTH = 16;
export const SESSION_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

export type SessionEventAccessStatus =
  | "invalid"
  | "scheduled"
  | "closed"
  | "active";

export type SessionEventAccessLinkInput = {
  active: boolean;
  revokedAt: Date | null;
} | null;

export type SessionEventAccessEventInput = {
  status: string;
  startsAt: Date;
  autoCloseAt: Date | null;
  endsAt: Date;
  closedAt: Date | null;
} | null;

export function isValidSessionCodeFormat(code: string) {
  return (
    code.length >= SESSION_CODE_MIN_LENGTH && SESSION_CODE_PATTERN.test(code)
  );
}

export function getSessionEventAccessStatus({
  link,
  event,
  now = new Date(),
}: {
  link: SessionEventAccessLinkInput;
  event: SessionEventAccessEventInput;
  now?: Date;
}): SessionEventAccessStatus {
  if (!link || !link.active || link.revokedAt || !event) {
    return "invalid";
  }

  const phase = getEventPhase(event, now);

  if (phase === "cancelled" || phase === "ended") {
    return "closed";
  }

  if (phase === "upcoming") {
    return "scheduled";
  }

  return "active";
}
