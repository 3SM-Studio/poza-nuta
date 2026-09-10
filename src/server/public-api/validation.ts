export const MAX_NOTE_LENGTH = 300;
export const MAX_SEARCH_QUERY_LENGTH = 100;
export const MIN_SEARCH_QUERY_LENGTH = 2;

export type ValidationIssue = {
  field: string;
  message: string;
};

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };

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
