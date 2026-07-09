const UNIQUE_VIOLATION_CODE = "23505";
const EVENT_SLUG_INDEX_NAME = "events_slug_idx";
const MAX_ERROR_CAUSE_DEPTH = 5;

export function isEventSlugUniqueViolation(error: unknown) {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (!isRecord(current) || seen.has(current)) {
      return false;
    }

    seen.add(current);

    if (isDirectEventSlugUniqueViolation(current)) {
      return true;
    }

    current = current.cause;
  }

  return false;
}

function isDirectEventSlugUniqueViolation(error: Record<string, unknown>) {
  if (error.code !== UNIQUE_VIOLATION_CODE) {
    return false;
  }

  return (
    error.constraint === EVENT_SLUG_INDEX_NAME ||
    error.constraint_name === EVENT_SLUG_INDEX_NAME
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
