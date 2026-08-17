import type {
  ValidationIssue,
  ValidationResult,
} from "../public-api/validation.ts";
import {
  isParticipantNicknameLengthValid,
  normalizeParticipantNickname,
} from "../../lib/participant-nickname.ts";

export type ParticipantJoinInput = {
  displayName: string;
  normalizedDisplayName: string;
};

export type ParticipantSessionRequestInput = {
  songId: number;
};

export function validateParticipantJoinInput(
  input: unknown,
): ValidationResult<ParticipantJoinInput> {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ field: "body", message: "Body must be a JSON object." }],
    };
  }

  if (typeof input.displayName !== "string") {
    return {
      success: false,
      issues: [{ field: "displayName", message: "displayName must be a string." }],
    };
  }

  const nickname = normalizeParticipantNickname(input.displayName);
  if (!isParticipantNicknameLengthValid(nickname.displayName)) {
    return {
      success: false,
      issues: [
        {
          field: "displayName",
          message: "displayName must contain between 2 and 24 characters.",
        },
      ],
    };
  }

  return { success: true, data: nickname };
}

export function validateParticipantSessionRequestInput(
  input: unknown,
): ValidationResult<ParticipantSessionRequestInput> {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ field: "body", message: "Body must be a JSON object." }],
    };
  }

  const issues: ValidationIssue[] = [];
  const songId = input.songId;
  if (typeof songId !== "number" || !Number.isSafeInteger(songId) || songId <= 0) {
    issues.push({ field: "songId", message: "songId must be a positive integer." });
  }

  for (const field of Object.keys(input)) {
    if (field !== "songId") {
      issues.push({
        field,
        message: `${field} is not accepted for participant requests.`,
      });
    }
  }

  if (issues.length > 0) return { success: false, issues };
  return {
    success: true,
    data: { songId: songId as number },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
