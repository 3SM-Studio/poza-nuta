import { getDbTelemetryCorrelation, runWithDbTelemetry } from "./db-telemetry.ts";

export const SERVER_STEP_TIMEOUT_MS = 8_000;

const CONNECTION_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s'"]+/gi;
const ENV_SECRET_PATTERN =
  /\b(DATABASE_URL|DIRECT_URL|IMPORT_WORKER_DATABASE_URL|PASSWORD|TOKEN|SECRET|KEY)=\S+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const AUTH_HEADER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

const INFRASTRUCTURE_TIMEOUT_CODES = new Set([
  "55P03",
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
  "DATABASE_CONNECTION_MODE_INVALID",
  "DATABASE_URL_MISSING",
  "EMAXCONNSESSION",
]);

const DATABASE_CONNECTION_CAPACITY_MESSAGE_PATTERNS = [
  "emaxconnsession",
  "maxclientsinsessionmode",
  "max clients in session mode",
];

const INFRASTRUCTURE_TIMEOUT_MESSAGE_PATTERNS = [
  "canceling statement due to statement timeout",
  "statement timeout",
  "connection timed out",
  "connection timeout",
  "connect timeout",
  "timed out fetching a new connection",
  "timeout acquiring a connection",
  "pool timeout",
];

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

export async function traceServerStepWithoutTimeout<T>(
  routeName: string,
  stepName: string,
  action: () => Promise<T>,
) {
  return runWithDbTelemetry(routeName, async () => {
    const start = Date.now();

    try {
      const result = await Promise.resolve().then(action);

      logServerStep(routeName, stepName, start, "success");

      return result;
    } catch (error) {
      logServerStep(routeName, stepName, start, "failure", error);
      throw error;
    }
  });
}

export async function withRuntimeDiagnostics<T>(
  routeName: string,
  stepName: string,
  action: () => Promise<T>,
  timeoutMs = SERVER_STEP_TIMEOUT_MS,
) {
  return runWithDbTelemetry(routeName, async () => {
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
  });
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

  // HEAD used the top-level safe message for runtime/HTTP decisions.
  // Cause-chain messages remain available to classifyDatabaseError telemetry.
  const message = hasDatabaseConnectionCapacityError(error)
    ? "Database connection capacity exhausted."
    : error instanceof Error
      ? sanitizeLogValue(error.message)
      : "Unknown error";

  return INFRASTRUCTURE_TIMEOUT_MESSAGE_PATTERNS.some((pattern) =>
    message.toLowerCase().includes(pattern),
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

  if (hasDatabaseConnectionCapacityError(error)) {
    return true;
  }

  const messages = getErrorMessages(error).map((message) =>
    message.toLowerCase(),
  );

  return messages.some(
    (message) =>
      message.includes("connection terminated") ||
      message.includes("connection closed") ||
      message.includes("connection refused") ||
      message === "fetch failed" ||
      message.includes("network error"),
  );
}

export function getSafeErrorCode(error: unknown) {
  if (hasDatabaseConnectionCapacityError(error)) {
    return "EMAXCONNSESSION";
  }

  const code = getErrorCode(error) ?? getErrorName(error);
  return /^[A-Za-z][A-Za-z0-9_]{1,31}$|^[0-9A-Z]{5}$/.test(code)
    ? code
    : "UnknownError";
}

export function getSafeErrorMessage(error: unknown) {
  if (hasDatabaseConnectionCapacityError(error)) {
    return "Database connection capacity exhausted.";
  }

  // Arbitrary driver errors may contain SQL, bound values, or personal data.
  return "Operation failed.";
}

export type DatabaseErrorClass =
  | "DB_LOCK_TIMEOUT"
  | "DB_STATEMENT_TIMEOUT"
  | "DB_CONNECT_TIMEOUT"
  | "DB_CONNECTION_CAPACITY"
  | "DB_CONNECTION_CLOSED"
  | "APP_DEADLINE_EXCEEDED"
  | "UNKNOWN_DB_ERROR";

export function classifyDatabaseError(error: unknown): DatabaseErrorClass {
  if (error instanceof ServerStepTimeoutError) return "APP_DEADLINE_EXCEEDED";
  if (hasDatabaseConnectionCapacityError(error)) return "DB_CONNECTION_CAPACITY";
  const code = getErrorCode(error);
  const messages = getErrorMessages(error).map((message) => message.toLowerCase());
  if (["55P03", "57014"].includes(code ?? "") && messages.some((message) => message.includes("lock timeout"))) return "DB_LOCK_TIMEOUT";
  if (code === "57014" && messages.some((message) => message.includes("statement timeout"))) return "DB_STATEMENT_TIMEOUT";
  if (["CONNECT_TIMEOUT", "CONNECTION_TIMEOUT", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code ?? "") || messages.some((message) => message.includes("connect timeout") || message.includes("connection timed out"))) return "DB_CONNECT_TIMEOUT";
  if (["ECONNRESET", "57P01", "57P02"].includes(code ?? "") || messages.some((message) => message.includes("connection closed") || message.includes("connection terminated"))) return "DB_CONNECTION_CLOSED";
  return "UNKNOWN_DB_ERROR";
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
  const correlation = getDbTelemetryCorrelation(routeName);
  const fields = [
    "server_step",
    `request_id=${formatLogField(correlation.request_id)}`,
    `runtime_id=${formatLogField(correlation.runtime_id)}`,
    `route=${formatLogField(routeName)}`,
    `step=${formatLogField(stepName)}`,
    `duration_ms=${durationMs}`,
    `status=${status}`,
  ];
  if (correlation.commit) fields.push(`commit=${formatLogField(correlation.commit)}`);
  if (correlation.region) fields.push(`region=${formatLogField(correlation.region)}`);

  if (status === "success") {
    console.info(fields.join(" "));
    return;
  }

  console.warn(
    [
      ...fields,
      `error_code=${formatLogField(getSafeErrorCode(error))}`,
      `error_class=${formatLogField(classifyDatabaseError(error))}`,
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
  for (const current of getErrorChain(error)) {
    const code = current.code;

    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }

  return undefined;
}

function hasDatabaseConnectionCapacityError(error: unknown) {
  for (const current of getErrorChain(error)) {
    if (current.code === "EMAXCONNSESSION") {
      return true;
    }

    const message = current.message;
    if (
      typeof message === "string" &&
      DATABASE_CONNECTION_CAPACITY_MESSAGE_PATTERNS.some((pattern) =>
        message.toLowerCase().includes(pattern),
      )
    ) {
      return true;
    }
  }

  return false;
}

function getErrorMessages(error: unknown) {
  return getErrorChain(error).flatMap((current) =>
    typeof current.message === "string" ? [current.message] : [],
  );
}

function getErrorChain(error: unknown) {
  const chain: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  let current = asRecord(error);

  while (current && chain.length < 8 && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = asRecord(current.cause);
  }

  return chain;
}

function asRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}
