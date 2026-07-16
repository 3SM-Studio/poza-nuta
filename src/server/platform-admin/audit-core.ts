export const platformAuditActions = [
  "platform_role.grant",
  "platform_role.change",
  "platform_role.deactivate",
  "platform_role.remove",
  "user.suspend",
  "user.unlock",
  "import.start",
  "import.cancel",
  "import.complete",
  "import.fail",
  "retention.cleanup",
] as const;

export const platformAuditTargetTypes = [
  "platform_member",
  "operator_user",
  "import_job",
  "retention_cleanup",
] as const;

export const platformAuditOutcomes = ["success", "failure"] as const;

export type PlatformAuditAction = (typeof platformAuditActions)[number];
export type PlatformAuditTargetType =
  (typeof platformAuditTargetTypes)[number];
export type PlatformAuditOutcome = (typeof platformAuditOutcomes)[number];
export type PlatformAuditMetadata = Record<string, unknown>;

export type PlatformAuditEvent = {
  action: PlatformAuditAction;
  targetType: PlatformAuditTargetType;
  targetId: string;
  outcome: PlatformAuditOutcome;
  summary: string;
  reason?: string;
  metadata?: PlatformAuditMetadata;
};

export type PlatformAuditRecord = {
  actorKind: "operator" | "system";
  operatorId: number | null;
  action: PlatformAuditAction;
  entityId: string;
  payload: {
    schemaVersion: 1;
    targetType: PlatformAuditTargetType;
    outcome: PlatformAuditOutcome;
    summary: string;
    reason?: string;
    metadata?: PlatformAuditMetadata;
  };
};

export class PlatformAuditValidationError extends Error {
  readonly code = "INVALID_PLATFORM_AUDIT_EVENT";

  constructor(message: string) {
    super(message);
    this.name = "PlatformAuditValidationError";
  }
}

const forbiddenKeyPattern =
  /^(access[_-]?token|refresh[_-]?token|token|cookie|cookies|authorization|password|password[_-]?hash|secret|service[_-]?role|api[_-]?key|private[_-]?key|session|jwt|auth|auth[_-]?user|user[_-]?metadata|app[_-]?metadata|identities|email|raw[_-]?error|error|stack|cause|actor[_-]?id|role)$/i;
const maxTextLength = 500;
const maxTargetIdLength = 128;
const maxMetadataDepth = 5;
const maxMetadataEntries = 50;
const maxPayloadBytes = 8_192;
const sensitiveTextPatterns = [
  /\bbearer\s+[a-z0-9._~+/=-]+/i,
  /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/i,
  /\b(?:cookie|set-cookie)\s*:/i,
  /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i,
];

export function createPlatformAuditRecord(
  operatorId: number,
  event: PlatformAuditEvent,
): PlatformAuditRecord {
  if (!Number.isSafeInteger(operatorId) || operatorId <= 0) {
    throw new PlatformAuditValidationError("Audit actor is invalid.");
  }

  return createValidatedPlatformAuditRecord("operator", operatorId, event);
}

export function createSystemPlatformAuditRecord(
  event: PlatformAuditEvent,
): PlatformAuditRecord {
  return createValidatedPlatformAuditRecord("system", null, event);
}

function createValidatedPlatformAuditRecord(
  actorKind: PlatformAuditRecord["actorKind"],
  operatorId: number | null,
  event: PlatformAuditEvent,
): PlatformAuditRecord {

  assertIncluded(platformAuditActions, event.action, "action");
  assertIncluded(platformAuditTargetTypes, event.targetType, "target type");
  assertIncluded(platformAuditOutcomes, event.outcome, "outcome");

  const targetId = validateText(event.targetId, "target ID", maxTargetIdLength);
  const summary = validateText(event.summary, "summary", maxTextLength);
  const reason = event.reason
    ? validateText(event.reason, "reason", maxTextLength)
    : undefined;
  const metadata = event.metadata
    ? sanitizeMetadata(event.metadata)
    : undefined;

  const payload: PlatformAuditRecord["payload"] = {
    schemaVersion: 1,
    targetType: event.targetType,
    outcome: event.outcome,
    summary,
    ...(reason ? { reason } : {}),
    ...(metadata ? { metadata } : {}),
  };

  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > maxPayloadBytes) {
    throw new PlatformAuditValidationError("Audit payload is too large.");
  }

  return {
    actorKind,
    operatorId,
    action: event.action,
    entityId: targetId,
    payload,
  };
}

function sanitizeMetadata(metadata: PlatformAuditMetadata) {
  const state = { entries: 0 };
  return sanitizeObject(metadata, 0, state);
}

function sanitizeObject(
  value: Record<string, unknown>,
  depth: number,
  state: { entries: number },
): PlatformAuditMetadata {
  if (!isPlainObject(value)) {
    throw new PlatformAuditValidationError(
      "Audit metadata must contain plain objects only.",
    );
  }
  if (depth > maxMetadataDepth) {
    throw new PlatformAuditValidationError("Audit metadata is too deeply nested.");
  }

  const sanitized: PlatformAuditMetadata = {};
  for (const [key, item] of Object.entries(value)) {
    state.entries += 1;
    if (state.entries > maxMetadataEntries) {
      throw new PlatformAuditValidationError(
        "Audit metadata contains too many entries.",
      );
    }
    if (forbiddenKeyPattern.test(key)) {
      throw new PlatformAuditValidationError(
        `Audit metadata key is not permitted: ${key}.`,
      );
    }
    sanitized[key] = sanitizeValue(item, depth + 1, state);
  }
  return sanitized;
}

function sanitizeValue(
  value: unknown,
  depth: number,
  state: { entries: number },
): unknown {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return validateText(value, "metadata value", maxTextLength, true);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Error) {
    throw new PlatformAuditValidationError("Raw errors are not permitted.");
  }
  if (Array.isArray(value)) {
    if (depth > maxMetadataDepth) {
      throw new PlatformAuditValidationError(
        "Audit metadata is too deeply nested.",
      );
    }
    return value.map((item) => sanitizeValue(item, depth + 1, state));
  }
  if (isPlainObject(value)) {
    return sanitizeObject(value, depth, state);
  }
  throw new PlatformAuditValidationError(
    "Audit metadata contains an unsupported value.",
  );
}

function validateText(
  value: string,
  field: string,
  maximumLength: number,
  allowEmpty = false,
) {
  if (typeof value !== "string") {
    throw new PlatformAuditValidationError(`Audit ${field} must be text.`);
  }
  const normalized = value.trim();
  if (!allowEmpty && normalized.length === 0) {
    throw new PlatformAuditValidationError(`Audit ${field} is required.`);
  }
  if (normalized.length > maximumLength) {
    throw new PlatformAuditValidationError(`Audit ${field} is too long.`);
  }
  if (sensitiveTextPatterns.some((pattern) => pattern.test(normalized))) {
    throw new PlatformAuditValidationError(
      `Audit ${field} contains sensitive data.`,
    );
  }
  return normalized;
}

function assertIncluded<T extends string>(
  values: readonly T[],
  value: T,
  field: string,
): void {
  if (!values.includes(value)) {
    throw new PlatformAuditValidationError(`Audit ${field} is invalid.`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
