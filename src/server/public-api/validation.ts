export const MAX_SINGER_NAME_LENGTH = 80;
export const MAX_NOTE_LENGTH = 300;
export const MAX_SEARCH_QUERY_LENGTH = 100;
export const MIN_SEARCH_QUERY_LENGTH = 2;

export type PublicRequestInput = {
  songId: number;
  singerName: string;
  note: string | null;
};

export type ValidationIssue = {
  field: string;
  message: string;
};

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };

export function validatePublicRequestInput(
  input: unknown,
): ValidationResult<PublicRequestInput> {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ field: "body", message: "Body must be a JSON object." }],
    };
  }

  const issues: ValidationIssue[] = [];
  const songId = input.songId;
  const singerName =
    typeof input.singerName === "string" ? input.singerName.trim() : "";
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

  if (typeof input.singerName !== "string" || singerName.length === 0) {
    issues.push({
      field: "singerName",
      message: "singerName is required.",
    });
  } else if (singerName.length > MAX_SINGER_NAME_LENGTH) {
    issues.push({
      field: "singerName",
      message: `singerName must contain at most ${MAX_SINGER_NAME_LENGTH} characters.`,
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

export function validateSearchQuery(
  input: string | null,
): ValidationResult<string | null> {
  const query = input?.trim() ?? "";

  if (query.length < MIN_SEARCH_QUERY_LENGTH) {
    return { success: true, data: null };
  }

  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    return {
      success: false,
      issues: [
        {
          field: "q",
          message: `q must contain at most ${MAX_SEARCH_QUERY_LENGTH} characters.`,
        },
      ],
    };
  }

  return {
    success: true,
    data: normalizeSearchQuery(query),
  };
}

export function normalizeSearchQuery(input: string) {
  return input
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("pl-PL")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
