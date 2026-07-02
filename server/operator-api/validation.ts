export const DEFAULT_OPERATOR_NAME = "Operator";
export const MAX_OPERATOR_NAME_LENGTH = 120;
export const MAX_OPERATOR_EMAIL_LENGTH = 254;
export const MIN_OPERATOR_PASSWORD_LENGTH = 6;
export const MAX_OPERATOR_PASSWORD_LENGTH = 1_024;

export type LoginInput = {
  email: string;
  password: string;
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
  const email =
    typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (typeof input.email !== "string" || email.length === 0) {
    issues.push({ field: "email", message: "email is required." });
  } else if (email.length > MAX_OPERATOR_EMAIL_LENGTH) {
    issues.push({
      field: "email",
      message: `email must contain at most ${MAX_OPERATOR_EMAIL_LENGTH} characters.`,
    });
  } else if (!isValidEmail(email)) {
    issues.push({ field: "email", message: "email must be valid." });
  }

  if (typeof input.password !== "string" || password.length === 0) {
    issues.push({ field: "password", message: "password is required." });
  } else if (
    password.length < MIN_OPERATOR_PASSWORD_LENGTH ||
    password.length > MAX_OPERATOR_PASSWORD_LENGTH
  ) {
    issues.push({
      field: "password",
      message: `password must contain between ${MIN_OPERATOR_PASSWORD_LENGTH} and ${MAX_OPERATOR_PASSWORD_LENGTH} characters.`,
    });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: { email, password },
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

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
