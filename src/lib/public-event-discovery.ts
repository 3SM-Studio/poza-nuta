import type { PublicEventStatus } from "./public-event-contract.ts";
import { parseWarsawDateTimeLocal, WARSAW_TIME_ZONE } from "./warsaw-time.ts";

export const publicEventPhaseValues = ["all", "live", "upcoming", "ended"] as const;
export const publicEventSortValues = ["soonest", "newest"] as const;

export type PublicEventPhaseFilter = (typeof publicEventPhaseValues)[number];
export type PublicEventSort = (typeof publicEventSortValues)[number];

export type PublicEventsQuery = {
  q?: string | null;
  city?: string | null;
  date?: string | null;
  phase?: PublicEventPhaseFilter | string | null;
  sort?: PublicEventSort | string | null;
};

export type NormalizedPublicEventsQuery = {
  q: string | null;
  city: string | null;
  date: string | null;
  phase: PublicEventPhaseFilter;
  sort: PublicEventSort;
};

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

const warsawDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: WARSAW_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function normalizePublicEventsQuery(
  query: PublicEventsQuery,
): NormalizedPublicEventsQuery {
  return {
    q: normalizeOptionalText(query.q),
    city: normalizeOptionalText(query.city),
    date: normalizePublicEventDate(query.date),
    phase: normalizePublicEventPhase(query.phase),
    sort: normalizePublicEventSort(query.sort),
  };
}

export function normalizePublicEventPhase(
  value: PublicEventPhaseFilter | string | null | undefined,
): PublicEventPhaseFilter {
  return publicEventPhaseValues.includes(value as PublicEventPhaseFilter)
    ? (value as PublicEventPhaseFilter)
    : "all";
}

export function normalizePublicEventSort(
  value: PublicEventSort | string | null | undefined,
): PublicEventSort {
  return publicEventSortValues.includes(value as PublicEventSort)
    ? (value as PublicEventSort)
    : "soonest";
}

export function getPublicEventDateRange(date: string | null) {
  if (!date) {
    return null;
  }

  const calendarDate = parseCalendarDate(date);

  if (!calendarDate) {
    return null;
  }

  const start = parseWarsawDateTimeLocal(`${formatCalendarDate(calendarDate)}T00:00`);
  const end = parseWarsawDateTimeLocal(
    `${formatCalendarDate(addCalendarDays(calendarDate, 1))}T00:00`,
  );

  return start && end ? { start, end } : null;
}

export function getWarsawWeekendRange(referenceNow = new Date()) {
  const referenceDate = getWarsawCalendarDate(referenceNow);
  const weekday = getCalendarWeekday(referenceDate);
  const daysUntilWeekendStart =
    weekday === 0 ? -1 : weekday === 6 ? 0 : 6 - weekday;
  const startDate = addCalendarDays(referenceDate, daysUntilWeekendStart);
  const endDate = addCalendarDays(startDate, 2);
  const start = parseWarsawDateTimeLocal(`${formatCalendarDate(startDate)}T00:00`);
  const end = parseWarsawDateTimeLocal(`${formatCalendarDate(endDate)}T00:00`);

  if (!start || !end) {
    throw new Error("Unable to build Warsaw weekend range.");
  }

  return { start, end };
}

export function isInWarsawWeekend(
  startsAt: Date | string,
  referenceNow = new Date(),
) {
  const eventDate = startsAt instanceof Date ? startsAt : new Date(startsAt);
  const range = getWarsawWeekendRange(referenceNow);

  return eventDate >= range.start && eventDate < range.end;
}

export function matchesPublicEventPhase(
  status: PublicEventStatus,
  phase: PublicEventPhaseFilter,
) {
  return phase === "all" || status === phase;
}

export function isPromotablePublicEventStatus(status: PublicEventStatus) {
  return status === "live" || status === "upcoming";
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized || null;
}

function normalizePublicEventDate(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return parseCalendarDate(normalized) ? normalized : null;
}

function parseCalendarDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const timestamp = Date.UTC(date.year, date.month - 1, date.day);
  const utcDate = new Date(timestamp);

  return utcDate.getUTCFullYear() === date.year &&
    utcDate.getUTCMonth() === date.month - 1 &&
    utcDate.getUTCDate() === date.day
    ? date
    : null;
}

function getWarsawCalendarDate(date: Date): CalendarDate {
  const values = Object.fromEntries(
    warsawDateFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
  };
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const timestamp = Date.UTC(date.year, date.month - 1, date.day + days);
  const shifted = new Date(timestamp);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function getCalendarWeekday(date: CalendarDate) {
  const monthOffsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let year = date.year;

  if (date.month < 3) {
    year -= 1;
  }

  return (
    year +
    Math.floor(year / 4) -
    Math.floor(year / 100) +
    Math.floor(year / 400) +
    monthOffsets[date.month - 1] +
    date.day
  ) % 7;
}

function formatCalendarDate(date: CalendarDate) {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
