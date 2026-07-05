export const WARSAW_TIME_ZONE = "Europe/Warsaw";

const dateTimeLocalPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const warsawDateTimePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: WARSAW_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function isDateTimeLocalInput(value: string) {
  return dateTimeLocalPattern.test(value);
}

export function parseWarsawDateTimeLocal(value: string) {
  const match = dateTimeLocalPattern.exec(value);

  if (!match) {
    return null;
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
  };
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  if (!sameDateTimeParts(parts, getUtcParts(new Date(localAsUtc)))) {
    return null;
  }

  let utcTimestamp = localAsUtc;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const offset = getWarsawOffsetMilliseconds(new Date(utcTimestamp));
    const adjustedTimestamp = localAsUtc - offset;

    if (adjustedTimestamp === utcTimestamp) {
      break;
    }

    utcTimestamp = adjustedTimestamp;
  }

  const result = new Date(utcTimestamp);

  return sameDateTimeParts(parts, getWarsawParts(result)) ? result : null;
}

export function formatWarsawDateTimeLocal(value: Date | null) {
  if (!value) {
    return "";
  }

  const parts = getWarsawParts(value);

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(
    parts.hour,
  )}:${pad(parts.minute)}`;
}

export function formatWarsawDateTime(
  value: Date | string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
) {
  const date = value instanceof Date ? value : new Date(value);

  return new Intl.DateTimeFormat("pl-PL", {
    ...options,
    timeZone: WARSAW_TIME_ZONE,
  }).format(date);
}

function getWarsawOffsetMilliseconds(date: Date) {
  const parts = getWarsawParts(date);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const sourceTimestamp = Math.floor(date.getTime() / 1_000) * 1_000;

  return representedAsUtc - sourceTimestamp;
}

function getWarsawParts(date: Date) {
  const values = Object.fromEntries(
    warsawDateTimePartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function getUtcParts(date: Date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function sameDateTimeParts(
  left: ReturnType<typeof getUtcParts>,
  right: ReturnType<typeof getUtcParts>,
) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
