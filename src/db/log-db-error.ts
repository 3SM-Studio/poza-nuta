const SENSITIVE_LINE_PATTERN = /^(\s*params:\s*).+$/gim;
const CONNECTION_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s'"]+/gi;
const ENV_SECRET_PATTERN =
  /\b(DATABASE_URL|OPERATOR_BOOTSTRAP_PIN|PASSWORD|TOKEN|SECRET)=\S+/gi;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function sanitize(value: string) {
  return value
    .replace(SENSITIVE_LINE_PATTERN, "$1[redacted]")
    .replace(CONNECTION_URL_PATTERN, "postgres://[redacted]")
    .replace(ENV_SECRET_PATTERN, "$1=[redacted]");
}

function getStringField(
  source: Record<string, unknown> | undefined,
  field: string,
) {
  const value = source?.[field];

  return typeof value === "string" && value.length > 0
    ? sanitize(value)
    : undefined;
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? sanitize(error.message) : "Unknown error";
}

export function logDatabaseError(prefix: string, error: unknown) {
  console.error(`${prefix}:`);
  console.error(`  error.message: ${getErrorMessage(error)}`);

  const cause = asRecord(asRecord(error)?.cause);
  const causeMessage = getStringField(cause, "message");
  const causeCode = getStringField(cause, "code");
  const causeDetail = getStringField(cause, "detail");
  const causeHint = getStringField(cause, "hint");

  if (causeMessage) {
    console.error(`  error.cause.message: ${causeMessage}`);
  }

  if (causeCode) {
    console.error(`  error.cause.code: ${causeCode}`);
  }

  if (causeDetail) {
    console.error(`  error.cause.detail: ${causeDetail}`);
  }

  if (causeHint) {
    console.error(`  error.cause.hint: ${causeHint}`);
  }
}
