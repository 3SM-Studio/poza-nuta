import { isMeaningfulSongSearch, normalizeSongSearchQuery, normalizeLegacySongSearchText } from "../../lib/song-search.ts";
import { isUnicodeSongSearchEnabled } from "../../lib/song-search-engine.ts";
import {
  decodeSongSearchCursor,
  type SongSearchCursor,
} from "../../lib/song-search-cursor.ts";

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

  if ((input?.length ?? 0) > MAX_SEARCH_QUERY_LENGTH || /\p{Mark}{17}/u.test(query)) {
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

  const normalizedQuery = normalizeSearchQuery(query);

  return {
    success: true,
    data: isMeaningfulSongSearch(normalizedQuery) ? normalizedQuery : null,
  };
}

export function validateSongSearchRequest(
  searchParams: URLSearchParams,
): ValidationResult<{ query: string | null; cursor: SongSearchCursor | null }> {
  const queryValidation = validateSearchQuery(searchParams.get("q"));
  if (!queryValidation.success) return queryValidation;

  const cursorInput = searchParams.get("cursor");
  if (cursorInput === null || cursorInput === "") {
    return {
      success: true,
      data: { query: queryValidation.data, cursor: null },
    };
  }

  const cursor = queryValidation.data
    ? decodeSongSearchCursor(cursorInput, queryValidation.data, isUnicodeSongSearchEnabled() ? 2 : 1)
    : null;
  if (!cursor) {
    return {
      success: false,
      issues: [{ field: "cursor", message: "cursor is invalid." }],
    };
  }

  return {
    success: true,
    data: { query: queryValidation.data, cursor },
  };
}

export function normalizeSearchQuery(input: string) {
  return isUnicodeSongSearchEnabled() ? normalizeSongSearchQuery(input) : normalizeLegacySongSearchText(input, "NFKD");
}
