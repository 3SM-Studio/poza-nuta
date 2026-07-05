export const SERVER_STEP_TIMEOUT_MS = 10_000;

const CONNECTION_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s'"]+/gi;
const ENV_SECRET_PATTERN =
  /\b(DATABASE_URL|PASSWORD|TOKEN|SECRET|KEY)=\S+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const AUTH_HEADER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

const INFRASTRUCTURE_TIMEOUT_CODES = new Set([
  "57014",
  "CONNECT_TIMEOUT",
  "CONNECTION_TIMEOUT",
  "ETIMEDOUT",
  "P1001",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const TRANSIENT_ERROR_CODES = new Set([
  ...INFRASTRUCTURE_TIMEOUT_CODES,
  "CONNECT_TIMEOUT",
  "CONNECTION_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "P1001",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export class ServerStepTimeoutError extends Error {
  readonly code = "UPSTREAM_TIMEOUT";
  readonly routeName: string;
  readonly stepName: string;
  readonly timeoutMs: number;

  constructor(
    routeName: string,
    stepName: string,
    timeoutMs = SERVER_STEP_TIMEOUT_MS,
  ) {
    super(`${routeName} ${stepName} timed out after ${timeoutMs}ms.`);
    this.name = "ServerStepTimeoutError";
    this.routeName = routeName;
    this.stepName = stepName;
    this.timeoutMs = timeoutMs;
  }
}

export async function traceServerStep<T>(
  routeName: string,
  stepName: string,
  action: () => Promise<T>,
  timeoutMs = SERVER_STEP_TIMEOUT_MS,
) {
  return withRuntimeDiagnostics(routeName, stepName, action, timeoutMs);
}

export async function withRuntimeDiagnostics<T>(
  routeName: string,
  stepName: string,
  action: () => Promise<T>,
  timeoutMs = SERVER_STEP_TIMEOUT_MS,
) {
  const start = Date.now();

  try {
    const result = await withTimeout(
      Promise.resolve().then(action),
      routeName,
      stepName,
      timeoutMs,
    );

    logServerStep(routeName, stepName, start, "success");

    return result;
  } catch (error) {
    logServerStep(routeName, stepName, start, "failure", error);
    throw error;
  }
}

export function traceServerStepSync<T>(
  routeName: string,
  stepName: string,
  action: () => T,
) {
  const start = Date.now();

  try {
    const result = action();

    logServerStep(routeName, stepName, start, "success");

    return result;
  } catch (error) {
    logServerStep(routeName, stepName, start, "failure", error);
    throw error;
  }
}

export function isInfrastructureTimeout(error: unknown) {
  if (error instanceof ServerStepTimeoutError) {
    return true;
  }

  const code = getErrorCode(error);
  if (code && INFRASTRUCTURE_TIMEOUT_CODES.has(code)) {
    return true;
  }

  const message = getSafeErrorMessage(error).toLowerCase();

  return (
    message.includes("canceling statement due to statement timeout") ||
    message.includes("statement timeout") ||
    message.includes("timeout") ||
    message.includes("timed out")
  );
}

export function isTransientInfrastructureError(error: unknown) {
  if (isInfrastructureTimeout(error)) {
    return true;
  }

  const code = getErrorCode(error);
  if (code && TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }

  const message = getSafeErrorMessage(error).toLowerCase();

  return (
    message.includes("connection terminated") ||
    message.includes("connection closed") ||
    message.includes("connection refused")
  );
}

export function getSafeErrorCode(error: unknown) {
  return getErrorCode(error) ?? getErrorName(error);
}

export function getSafeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return sanitizeLogValue(error.message);
  }

  return "Unknown error";
}

function withTimeout<T>(
  promise: Promise<T>,
  routeName: string,
  stepName: string,
  timeoutMs: number,
) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new ServerStepTimeoutError(routeName, stepName, timeoutMs));
    }, timeoutMs);

    if (
      typeof timeout === "object" &&
      "unref" in timeout &&
      typeof timeout.unref === "function"
    ) {
      timeout.unref();
    }

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function logServerStep(
  routeName: string,
  stepName: string,
  start: number,
  status: "success" | "failure",
  error?: unknown,
) {
  const durationMs = Date.now() - start;
  const fields = [
    "server_step",
    `route=${formatLogField(routeName)}`,
    `step=${formatLogField(stepName)}`,
    `duration_ms=${durationMs}`,
    `status=${status}`,
  ];

  if (status === "success") {
    console.info(fields.join(" "));
    return;
  }

  console.warn(
    [
      ...fields,
      `error_code=${formatLogField(getSafeErrorCode(error))}`,
      `error_message=${formatLogField(getSafeErrorMessage(error))}`,
    ].join(" "),
  );
}

function sanitizeLogValue(value: string) {
  return value
    .replace(CONNECTION_URL_PATTERN, "postgres://[redacted]")
    .replace(ENV_SECRET_PATTERN, "$1=[redacted]")
    .replace(AUTH_HEADER_PATTERN, "$1 [redacted]")
    .replace(EMAIL_PATTERN, "[redacted-email]");
}

function formatLogField(value: string) {
  return JSON.stringify(sanitizeLogValue(value));
}

function getErrorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

function getErrorCode(error: unknown): string | undefined {
  const record = asRecord(error);
  const code = record?.code;

  if (typeof code === "string" && code.length > 0) {
    return code;
  }

  const causeCode = asRecord(record?.cause)?.code;

  return typeof causeCode === "string" && causeCode.length > 0
    ? causeCode
    : undefined;
}

function asRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}
