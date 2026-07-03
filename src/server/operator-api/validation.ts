export const DEFAULT_OPERATOR_NAME = "Operator";
export const MAX_OPERATOR_NAME_LENGTH = 120;
export const MAX_OPERATOR_EMAIL_LENGTH = 254;
export const MIN_OPERATOR_PASSWORD_LENGTH = 6;
export const MAX_OPERATOR_PASSWORD_LENGTH = 1_024;
export const MAX_EVENT_NAME_LENGTH = 120;
export const MAX_EVENT_VENUE_LENGTH = 120;

export type LoginInput = {
  email: string;
  password: string;
};

export type EventSettingsInput = {
  name: string;
  venue: string | null;
  publicQueueEnabled: boolean;
  publicShowSongTitles: boolean;
};

export type StartEventInput = {
  name: string;
  venue: string | null;
};

export type ExtendEventInput = {
  hours: 1 | 2;
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

export function validateEventSettingsInput(
  input: unknown,
): ValidationResult<EventSettingsInput> {
  if (!isRecord(input)) {
    return invalidBodyResult();
  }

  const eventFields = validateEventNameAndVenue(input);
  const issues = [...eventFields.issues];

  if (typeof input.publicQueueEnabled !== "boolean") {
    issues.push({
      field: "publicQueueEnabled",
      message: "publicQueueEnabled must be a boolean.",
    });
  }

  if (typeof input.publicShowSongTitles !== "boolean") {
    issues.push({
      field: "publicShowSongTitles",
      message: "publicShowSongTitles must be a boolean.",
    });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: {
      name: eventFields.name,
      venue: eventFields.venue,
      publicQueueEnabled: input.publicQueueEnabled as boolean,
      publicShowSongTitles: input.publicShowSongTitles as boolean,
    },
  };
}

export function validateStartEventInput(
  input: unknown,
): ValidationResult<StartEventInput> {
  if (!isRecord(input)) {
    return invalidBodyResult();
  }

  const eventFields = validateEventNameAndVenue(input);

  if (eventFields.issues.length > 0) {
    return { success: false, issues: eventFields.issues };
  }

  return {
    success: true,
    data: {
      name: eventFields.name,
      venue: eventFields.venue,
    },
  };
}

export function validateExtendInput(
  input: unknown,
): ValidationResult<ExtendEventInput> {
  if (!isRecord(input)) {
    return invalidBodyResult();
  }

  if (input.hours !== 1 && input.hours !== 2) {
    return {
      success: false,
      issues: [
        {
          field: "hours",
          message: "hours must be either 1 or 2.",
        },
      ],
    };
  }

  return {
    success: true,
    data: { hours: input.hours },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function invalidBodyResult(): ValidationResult<never> {
  return {
    success: false,
    issues: [{ field: "body", message: "Body must be a JSON object." }],
  };
}

function validateEventNameAndVenue(input: Record<string, unknown>) {
  const issues: ValidationIssue[] = [];
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const venue =
    typeof input.venue === "string" ? input.venue.trim() || null : null;

  if (typeof input.name !== "string" || name.length === 0) {
    issues.push({ field: "name", message: "name is required." });
  } else if (name.length > MAX_EVENT_NAME_LENGTH) {
    issues.push({
      field: "name",
      message: `name must contain at most ${MAX_EVENT_NAME_LENGTH} characters.`,
    });
  }

  if (
    input.venue !== undefined &&
    input.venue !== null &&
    typeof input.venue !== "string"
  ) {
    issues.push({
      field: "venue",
      message: "venue must be a string or null.",
    });
  } else if (venue && venue.length > MAX_EVENT_VENUE_LENGTH) {
    issues.push({
      field: "venue",
      message: `venue must contain at most ${MAX_EVENT_VENUE_LENGTH} characters.`,
    });
  }

  return { name, venue, issues };
}
