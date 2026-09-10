const UNIQUE_VIOLATION_CODE = "23505";
const SESSION_CODE_INDEX_NAMES = new Set([
  "events_session_code_idx",
  "event_session_codes_code_idx",
]);
const MAX_ERROR_CAUSE_DEPTH = 5;

export function isSessionCodeUniqueViolation(error: unknown) {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (!isRecord(current) || seen.has(current)) return false;
    seen.add(current);

    if (
      current.code === UNIQUE_VIOLATION_CODE &&
      ((typeof current.constraint === "string" &&
        SESSION_CODE_INDEX_NAMES.has(current.constraint)) ||
        (typeof current.constraint_name === "string" &&
          SESSION_CODE_INDEX_NAMES.has(current.constraint_name)))
    ) {
      return true;
    }

    current = current.cause;
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
