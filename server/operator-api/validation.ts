export const DEFAULT_OPERATOR_NAME = "Operator";
export const MAX_OPERATOR_NAME_LENGTH = 120;
export const MIN_OPERATOR_PIN_LENGTH = 4;
export const MAX_OPERATOR_PIN_LENGTH = 128;

export type LoginInput = {
  name: string;
  pin: string;
};

export type ValidationIssue = {
  field: string;
  message: string;
};

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };

export function validateLoginInput(
  input: unknown,
): ValidationResult<LoginInput> {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ field: "body", message: "Body must be a JSON object." }],
    };
  }

  const issues: ValidationIssue[] = [];
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const pin = typeof input.pin === "string" ? input.pin : "";

  if (typeof input.name !== "string" || name.length === 0) {
    issues.push({ field: "name", message: "name is required." });
  } else if (name.length > MAX_OPERATOR_NAME_LENGTH) {
    issues.push({
      field: "name",
      message: `name must contain at most ${MAX_OPERATOR_NAME_LENGTH} characters.`,
    });
  }

  if (typeof input.pin !== "string" || pin.length === 0) {
    issues.push({ field: "pin", message: "pin is required." });
  } else if (
    pin.length < MIN_OPERATOR_PIN_LENGTH ||
    pin.length > MAX_OPERATOR_PIN_LENGTH
  ) {
    issues.push({
      field: "pin",
      message: `pin must contain between ${MIN_OPERATOR_PIN_LENGTH} and ${MAX_OPERATOR_PIN_LENGTH} characters.`,
    });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: { name, pin },
  };
}

export function validateRequestId(value: string): ValidationResult<number> {
  if (!/^[1-9]\d*$/.test(value)) {
    return {
      success: false,
      issues: [
        {
          field: "requestId",
          message: "requestId must be a positive integer.",
        },
      ],
    };
  }

  const requestId = Number(value);

  if (!Number.isSafeInteger(requestId)) {
    return {
      success: false,
      issues: [
        {
          field: "requestId",
          message: "requestId must be a safe positive integer.",
        },
      ],
    };
  }

  return { success: true, data: requestId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
