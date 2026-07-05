export const SESSION_CODE_MIN_LENGTH = 16;
export const SESSION_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

export type SessionEventAccessStatus =
  | "invalid"
  | "scheduled"
  | "closed"
  | "disabled"
  | "active";

export type SessionEventAccessLinkInput = {
  active: boolean;
  revokedAt: Date | null;
} | null;

export type SessionEventAccessEventInput = {
  status: string;
  startsAt: Date;
  autoCloseAt: Date | null;
  closedAt: Date | null;
  publicQueueEnabled: boolean;
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

  if (event.closedAt || event.status === "closed") {
    return "closed";
  }

  if (now.getTime() < event.startsAt.getTime()) {
    return "scheduled";
  }

  if (!event.autoCloseAt || now.getTime() >= event.autoCloseAt.getTime()) {
    return "closed";
  }

  if (!event.publicQueueEnabled) {
    return "disabled";
  }

  return "active";
}
