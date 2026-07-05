export const SERVER_STEP_TIMEOUT_MS = 10_000;

const CONNECTION_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s'"]+/gi;
const ENV_SECRET_PATTERN =
  /\b(DATABASE_URL|PASSWORD|TOKEN|SECRET|KEY)=\S+/gi;

const TRANSIENT_ERROR_CODES = new Set([
  "57014",
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
  const start = Date.now();

  try {
    const result = await withTimeout(action(), routeName, stepName, timeoutMs);

    logServerStep(routeName, stepName, start, "success");

    return result;
  } catch (error) {
    logServerStep(routeName, stepName, start, "failure", error);
    throw error;
  }
}

export function isTransientInfrastructureError(error: unknown) {
  if (error instanceof ServerStepTimeoutError) {
    return true;
  }

  const code = getErrorCode(error);
  if (code && TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }

  const message = getSafeErrorMessage(error).toLowerCase();

  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
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
  const message = `${routeName} ${stepName} ${durationMs}ms ${status}`;

  if (status === "success") {
    console.info(message);
    return;
  }

  console.warn(
    `${message} ${getSafeErrorCode(error)} ${getSafeErrorMessage(error)}`,
  );
}

function sanitizeLogValue(value: string) {
  return value
    .replace(CONNECTION_URL_PATTERN, "postgres://[redacted]")
    .replace(ENV_SECRET_PATTERN, "$1=[redacted]");
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
