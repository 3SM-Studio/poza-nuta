import {
  MAX_NOTE_LENGTH,
  type ValidationIssue,
  type ValidationResult,
} from "../public-api/validation.ts";
import {
  normalizeSessionRequesterName,
  SESSION_REQUESTER_NAME_MAX_LENGTH,
  SESSION_REQUESTER_NAME_MIN_LENGTH,
} from "../../lib/session-request.ts";

export type SessionRequestInput = {
  songId: number;
  singerName: string;
  note: string | null;
};

export function validateSessionRequestInput(
  input: unknown,
): ValidationResult<SessionRequestInput> {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ field: "body", message: "Body must be a JSON object." }],
    };
  }

  const issues: ValidationIssue[] = [];
  const songId = input.songId;
  const singerName =
    typeof input.requesterName === "string"
      ? normalizeSessionRequesterName(input.requesterName)
      : typeof input.singerName === "string"
        ? normalizeSessionRequesterName(input.singerName)
        : "";
  const note =
    typeof input.note === "string" && input.note.trim().length > 0
      ? input.note.trim()
      : null;

  if (
    typeof songId !== "number" ||
    !Number.isSafeInteger(songId) ||
    songId <= 0
  ) {
    issues.push({
      field: "songId",
      message: "songId must be a positive integer.",
    });
  }

  if (singerName.length < SESSION_REQUESTER_NAME_MIN_LENGTH) {
    issues.push({
      field: "requesterName",
      message: `requesterName must contain at least ${SESSION_REQUESTER_NAME_MIN_LENGTH} characters.`,
    });
  } else if (singerName.length > SESSION_REQUESTER_NAME_MAX_LENGTH) {
    issues.push({
      field: "requesterName",
      message: `requesterName must contain at most ${SESSION_REQUESTER_NAME_MAX_LENGTH} characters.`,
    });
  }

  if (
    input.note !== undefined &&
    input.note !== null &&
    typeof input.note !== "string"
  ) {
    issues.push({
      field: "note",
      message: "note must be a string.",
    });
  } else if (note !== null && note.length > MAX_NOTE_LENGTH) {
    issues.push({
      field: "note",
      message: `note must contain at most ${MAX_NOTE_LENGTH} characters.`,
    });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: {
      songId: songId as number,
      singerName,
      note,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
