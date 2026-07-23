const UNIQUE_VIOLATION_CODE = "23505";
const IDENTITY_CONSTRAINTS = new Set([
  "events_public_id_idx",
  "event_sessions_public_token_idx",
]);
const MAX_ERROR_CAUSE_DEPTH = 5;

export function isEventSessionIdentityUniqueViolation(error: unknown) {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (!isRecord(current) || seen.has(current)) return false;
    seen.add(current);

    const constraint =
      typeof current.constraint === "string"
        ? current.constraint
        : typeof current.constraint_name === "string"
          ? current.constraint_name
          : null;

    if (
      current.code === UNIQUE_VIOLATION_CODE &&
      constraint !== null &&
      IDENTITY_CONSTRAINTS.has(constraint)
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
