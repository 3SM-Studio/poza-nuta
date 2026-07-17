import {
  isDateTimeLocalInput,
  parseWarsawDateTimeLocal,
} from "../../lib/warsaw-time.ts";
import { isStrongSignupPassword } from "../../lib/signup-password.ts";
import { formatEventSlug, isValidEventSlug } from "../../lib/event-slug.ts";

export const DEFAULT_OPERATOR_NAME = "Operator";
export const MAX_OPERATOR_NAME_LENGTH = 120;
export const MAX_OPERATOR_EMAIL_LENGTH = 254;
export const MIN_OPERATOR_PASSWORD_LENGTH = 6;
export const MIN_SIGNUP_PASSWORD_LENGTH = 8;
export const MAX_OPERATOR_PASSWORD_LENGTH = 1_024;
export const MIN_OPERATOR_PROFILE_DISPLAY_NAME_LENGTH = 2;
export const MAX_OPERATOR_PROFILE_DISPLAY_NAME_LENGTH = 80;
export const MAX_EVENT_NAME_LENGTH = 120;
export const MAX_EVENT_VENUE_LENGTH = 120;
export const MAX_EVENT_CITY_LENGTH = 120;
export const MAX_EVENT_FACEBOOK_URL_LENGTH = 2_048;
export const DEFAULT_DASHBOARD_EVENT_DURATION_HOURS = 6;

export type LoginInput = {
  email: string;
  password: string;
};

export type SignupInput = {
  email: string;
  password: string;
};

export type OperatorProfileInput = {
  displayName: string;
};

export type EventSettingsInput = {
  name: string;
  venue: string | null;
  songRequestsEnabled: boolean;
  publicQueueEnabled: boolean;
  publicShowSongTitles: boolean;
};

export type StartEventInput = {
  name: string;
  venue: string | null;
};

export type CreateDashboardEventInput = {
  title: string;
  venue: string | null;
  city: string | null;
  slug: string | null;
  visibility: "private" | "public";
  startsAt: Date;
  autoCloseAt: Date;
  facebookUrl: string | null;
  songRequestsEnabled: boolean;
  publicQueueEnabled: boolean;
  publicShowSongTitles: boolean;
  isActivePublicEvent: boolean;
};

export type UpdateDashboardEventDetailsInput = {
  title: string;
  venue: string | null;
  city: string | null;
  slug: string | null;
  visibility: "private" | "public";
  startsAt: Date;
  autoCloseAt: Date;
  facebookUrl: string | null;
  songRequestsEnabled: boolean;
  publicQueueEnabled: boolean;
  publicShowSongTitles: boolean;
  isActivePublicEvent: boolean;
};

export type UpdateDashboardEventAutoCloseAtInput = {
  autoCloseAt: Date;
};

export type ExtendDashboardEventInput = {
  minutes: 30 | 60 | 120;
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
  return validatePositiveSafeInteger(value, "requestId");
}

export function validateEventId(value: string): ValidationResult<number> {
  return validatePositiveSafeInteger(value, "eventId");
}

function validatePositiveSafeInteger(
  value: string,
  field: string,
): ValidationResult<number> {
  if (!/^[1-9]\d*$/.test(value)) {
    return {
      success: false,
      issues: [
        {
          field,
          message: `${field} must be a positive integer.`,
        },
      ],
    };
  }

  const parsedId = Number(value);

  if (!Number.isSafeInteger(parsedId)) {
    return {
      success: false,
      issues: [
        {
          field,
          message: `${field} must be a safe positive integer.`,
        },
      ],
    };
  }

  return { success: true, data: parsedId };
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

  if (typeof input.songRequestsEnabled !== "boolean") {
    issues.push({
      field: "songRequestsEnabled",
      message: "songRequestsEnabled must be a boolean.",
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
      songRequestsEnabled: input.songRequestsEnabled as boolean,
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

export function validateSignupInput(
  input: unknown,
): ValidationResult<SignupInput> {
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
  const confirmPassword =
    typeof input.confirmPassword === "string" ? input.confirmPassword : "";

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
    password.length < MIN_SIGNUP_PASSWORD_LENGTH ||
    password.length > MAX_OPERATOR_PASSWORD_LENGTH
  ) {
    issues.push({
      field: "password",
      message: `password must contain between ${MIN_SIGNUP_PASSWORD_LENGTH} and ${MAX_OPERATOR_PASSWORD_LENGTH} characters.`,
    });
  } else if (!isStrongSignupPassword(password)) {
    issues.push({
      field: "password",
      message:
        "password must include uppercase, lowercase, number and special character.",
    });
  }

  if (
    typeof input.confirmPassword !== "string" ||
    confirmPassword.length === 0
  ) {
    issues.push({
      field: "confirmPassword",
      message: "confirmPassword is required.",
    });
  } else if (password !== confirmPassword) {
    issues.push({
      field: "confirmPassword",
      message: "confirmPassword must match password.",
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

export function validateOperatorProfileInput(
  input: unknown,
): ValidationResult<OperatorProfileInput> {
  if (!isRecord(input)) {
    return invalidBodyResult();
  }

  const issues: ValidationIssue[] = [];
  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : "";

  if (typeof input.displayName !== "string" || displayName.length === 0) {
    issues.push({ field: "displayName", message: "displayName is required." });
  } else if (displayName.length < MIN_OPERATOR_PROFILE_DISPLAY_NAME_LENGTH) {
    issues.push({
      field: "displayName",
      message: `displayName must contain at least ${MIN_OPERATOR_PROFILE_DISPLAY_NAME_LENGTH} characters.`,
    });
  } else if (displayName.length > MAX_OPERATOR_PROFILE_DISPLAY_NAME_LENGTH) {
    issues.push({
      field: "displayName",
      message: `displayName must contain at most ${MAX_OPERATOR_PROFILE_DISPLAY_NAME_LENGTH} characters.`,
    });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: { displayName },
  };
}

export function calculateDefaultDashboardEventAutoCloseAt(startsAt: Date) {
  return new Date(
    startsAt.getTime() +
      DEFAULT_DASHBOARD_EVENT_DURATION_HOURS * 60 * 60 * 1_000,
  );
}

export function validateCreateDashboardEventInput(
  input: unknown,
): ValidationResult<CreateDashboardEventInput> {
  if (!isRecord(input)) {
    return invalidBodyResult();
  }

  return validateDashboardEventDetailsInput(input);
}

export function validateUpdateDashboardEventDetailsInput(
  input: unknown,
): ValidationResult<UpdateDashboardEventDetailsInput> {
  if (!isRecord(input)) {
    return invalidBodyResult();
  }

  return validateDashboardEventDetailsInput(input);
}

function validateDashboardEventDetailsInput(
  input: Record<string, unknown>,
): ValidationResult<CreateDashboardEventInput> {
  const issues: ValidationIssue[] = [];
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const venue =
    typeof input.venue === "string" ? input.venue.trim() || null : null;
  const city =
    typeof input.city === "string" ? input.city.trim() || null : null;
  const slug = parseOptionalEventSlugInput(input.slug, issues);
  const visibility = parseEventVisibilityInput(input.visibility, issues);
  const startsAt = parseDateTimeInput(input.startsAt, "startsAt", issues);
  const requestedAutoCloseAt = parseOptionalDateTimeInput(
    input.autoCloseAt,
    "autoCloseAt",
    issues,
  );
  const facebookUrl = parseOptionalUrlInput(
    input.facebookUrl,
    "facebookUrl",
    issues,
  );

  if (typeof input.title !== "string" || title.length === 0) {
    issues.push({ field: "title", message: "title is required." });
  } else if (title.length > MAX_EVENT_NAME_LENGTH) {
    issues.push({
      field: "title",
      message: `title must contain at most ${MAX_EVENT_NAME_LENGTH} characters.`,
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

  if (
    input.city !== undefined &&
    input.city !== null &&
    typeof input.city !== "string"
  ) {
    issues.push({
      field: "city",
      message: "city must be a string or null.",
    });
  } else if (city && city.length > MAX_EVENT_CITY_LENGTH) {
    issues.push({
      field: "city",
      message: `city must contain at most ${MAX_EVENT_CITY_LENGTH} characters.`,
    });
  }

  if (!startsAt) {
    issues.push({ field: "startsAt", message: "startsAt is required." });
  }

  if (issues.length > 0 || !startsAt) {
    return { success: false, issues };
  }

  const autoCloseAt =
    requestedAutoCloseAt ?? calculateDefaultDashboardEventAutoCloseAt(startsAt);

  if (autoCloseAt.getTime() <= startsAt.getTime()) {
    issues.push({
      field: "autoCloseAt",
      message: "autoCloseAt must be after startsAt.",
    });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: {
      title,
      venue,
      city,
      slug,
      visibility,
      startsAt,
      autoCloseAt,
      facebookUrl,
      songRequestsEnabled: parseBooleanInput(input.songRequestsEnabled, false),
      publicQueueEnabled: parseBooleanInput(input.publicQueueEnabled, false),
      publicShowSongTitles: parseBooleanInput(input.publicShowSongTitles, true),
      isActivePublicEvent: parseBooleanInput(input.isActivePublicEvent, false),
    },
  };
}

function parseOptionalEventSlugInput(
  value: unknown,
  issues: ValidationIssue[],
) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    issues.push({ field: "slug", message: "slug must be a string or null." });
    return null;
  }

  const slug = formatEventSlug(value);

  if (!slug) {
    return null;
  }

  if (!isValidEventSlug(slug)) {
    issues.push({
      field: "slug",
      message:
        "slug must contain 3-80 lowercase letters, numbers, or single hyphens.",
    });
    return null;
  }

  return slug;
}

function parseEventVisibilityInput(
  value: unknown,
  issues: ValidationIssue[],
) {
  if (value === undefined || value === null || value === "") {
    return "private";
  }

  if (value === "private" || value === "public") {
    return value;
  }

  issues.push({
    field: "visibility",
    message: "visibility must be private or public.",
  });

  return "private";
}

export function validateUpdateDashboardEventAutoCloseAtInput(
  input: unknown,
  startsAt: Date,
): ValidationResult<UpdateDashboardEventAutoCloseAtInput> {
  if (!isRecord(input)) {
    return invalidBodyResult();
  }

  const issues: ValidationIssue[] = [];
  const autoCloseAt = parseDateTimeInput(
    input.autoCloseAt,
    "autoCloseAt",
    issues,
  );

  if (!autoCloseAt) {
    issues.push({
      field: "autoCloseAt",
      message: "autoCloseAt is required.",
    });
  }

  if (issues.length > 0 || !autoCloseAt) {
    return { success: false, issues };
  }

  if (autoCloseAt.getTime() <= startsAt.getTime()) {
    issues.push({
      field: "autoCloseAt",
      message: "autoCloseAt must be after startsAt.",
    });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: { autoCloseAt },
  };
}

export function validateExtendDashboardEventInput(
  input: unknown,
): ValidationResult<ExtendDashboardEventInput> {
  if (!isRecord(input)) {
    return invalidBodyResult();
  }

  const minutes =
    typeof input.minutes === "string" ? Number(input.minutes) : input.minutes;

  if (minutes !== 30 && minutes !== 60 && minutes !== 120) {
    return {
      success: false,
      issues: [
        {
          field: "minutes",
          message: "minutes must be 30, 60 or 120.",
        },
      ],
    };
  }

  return {
    success: true,
    data: { minutes },
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

function parseDateTimeInput(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  const date = isDateTimeLocalInput(normalizedValue)
    ? parseWarsawDateTimeLocal(normalizedValue)
    : new Date(normalizedValue);

  if (!date || !Number.isFinite(date.getTime())) {
    issues.push({ field, message: `${field} must be a valid date.` });
    return null;
  }

  return date;
}

function parseOptionalDateTimeInput(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  return parseDateTimeInput(value, field, issues);
}

function parseOptionalUrlInput(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    issues.push({ field, message: `${field} must be a string or null.` });
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.length > MAX_EVENT_FACEBOOK_URL_LENGTH) {
    issues.push({
      field,
      message: `${field} must contain at most ${MAX_EVENT_FACEBOOK_URL_LENGTH} characters.`,
    });
    return null;
  }

  try {
    const url = new URL(normalizedValue);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      issues.push({
        field,
        message: `${field} must use http or https.`,
      });
      return null;
    }

    return url.toString();
  } catch {
    issues.push({ field, message: `${field} must be a valid URL.` });
    return null;
  }
}

function parseBooleanInput(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  return value === "on" || value === "true" || value === "1";
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
