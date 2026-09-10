export const EVENT_SLUG_MIN_LENGTH = 3;
export const EVENT_SLUG_MAX_LENGTH = 80;
export const EVENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const polishCharacters: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
};

export function isValidEventSlug(value: string) {
  return (
    value.length >= EVENT_SLUG_MIN_LENGTH &&
    value.length <= EVENT_SLUG_MAX_LENGTH &&
    EVENT_SLUG_PATTERN.test(value)
  );
}

export function formatEventSlug(input: string) {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (character) => polishCharacters[character] ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, EVENT_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");

  return normalized;
}

export function buildEventSlugCandidate(input: {
  requestedSlug: string | null;
  name: string;
}) {
  return formatEventSlug(input.requestedSlug?.trim() || input.name);
}

export function buildEventSlugCollisionCandidate(input: {
  baseSlug: string;
  eventId: number;
}) {
  const suffix = `-${input.eventId}`;
  const baseLength = EVENT_SLUG_MAX_LENGTH - suffix.length;
  const trimmedBase = input.baseSlug
    .slice(0, Math.max(EVENT_SLUG_MIN_LENGTH, baseLength))
    .replace(/-+$/g, "");

  return `${trimmedBase}${suffix}`;
}
