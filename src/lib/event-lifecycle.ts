export const DEFAULT_EVENT_DURATION_HOURS = 8;
export const EVENT_CLOSING_WARNING_MINUTES = 30;

export type LazyCloseDecision =
  | "expired"
  | "not_expired"
  | "no_deadline";

export function calculateAutoCloseAt(startsAt: Date) {
  return new Date(
    startsAt.getTime() + DEFAULT_EVENT_DURATION_HOURS * 60 * 60 * 1_000,
  );
}

export function getLazyCloseDecision(
  autoCloseAt: Date | null,
  now = new Date(),
): LazyCloseDecision {
  if (!autoCloseAt) {
    return "no_deadline";
  }

  return autoCloseAt.getTime() <= now.getTime()
    ? "expired"
    : "not_expired";
}

export function shouldWarnEventClosingSoon(
  autoCloseAt: Date | string | null,
  now = new Date(),
) {
  if (!autoCloseAt) {
    return false;
  }

  const deadline =
    autoCloseAt instanceof Date ? autoCloseAt : new Date(autoCloseAt);
  const remainingMilliseconds = deadline.getTime() - now.getTime();

  return (
    Number.isFinite(remainingMilliseconds) &&
    remainingMilliseconds > 0 &&
    remainingMilliseconds <= EVENT_CLOSING_WARNING_MINUTES * 60 * 1_000
  );
}

export function formatEventTimeRemaining(
  autoCloseAt: Date | string | null,
  now = new Date(),
) {
  if (!autoCloseAt) {
    return "Brak terminu";
  }

  const deadline =
    autoCloseAt instanceof Date ? autoCloseAt : new Date(autoCloseAt);
  const remainingMilliseconds = deadline.getTime() - now.getTime();

  if (!Number.isFinite(remainingMilliseconds)) {
    return "Nieznany";
  }

  if (remainingMilliseconds <= 0) {
    return "Zamykanie";
  }

  const remainingMinutes = Math.ceil(remainingMilliseconds / 60_000);
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  return minutes === 0 ? `${hours} godz.` : `${hours} godz. ${minutes} min`;
}
