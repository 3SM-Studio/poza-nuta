const UNIQUE_VIOLATION_CODE = "23505";
const SESSION_CODE_INDEX_NAME = "events_session_code_idx";
const MAX_ERROR_CAUSE_DEPTH = 5;

export function isSessionCodeUniqueViolation(error: unknown) {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (!isRecord(current) || seen.has(current)) return false;
    seen.add(current);

    if (
      current.code === UNIQUE_VIOLATION_CODE &&
      (current.constraint === SESSION_CODE_INDEX_NAME ||
        current.constraint_name === SESSION_CODE_INDEX_NAME)
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
