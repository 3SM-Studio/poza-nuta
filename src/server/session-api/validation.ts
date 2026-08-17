import type {
  ValidationIssue,
  ValidationResult,
} from "../public-api/validation.ts";
import { validateSearchQuery } from "../public-api/validation.ts";
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

export type ParticipantRenameInput = ParticipantJoinInput;

export const PUBLIC_SONG_BROWSE_DEFAULT_LIMIT = 24;
export const PUBLIC_SONG_BROWSE_MAX_LIMIT = 40;

export type SongBrowseSort = "title" | "artist" | "newest";

export type SongBrowseCursor =
  | {
      version: 1;
      filterKey: string;
      sort: "title" | "artist";
      id: number;
      normalizedTitle: string;
      normalizedArtist: string;
    }
  | {
      version: 1;
      filterKey: string;
      sort: "newest";
      id: number;
      createdAt: string;
    };

export type PublicSongBrowseQuery = {
  cursor: SongBrowseCursor | null;
  limit: number;
  q: string | null;
  genre: string | null;
  language: string | null;
  duet: boolean;
  hit: boolean;
  sort: SongBrowseSort;
};

const PUBLIC_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export const validateParticipantRenameInput = validateParticipantJoinInput;

export function isPublicRequestId(value: string) {
  return PUBLIC_REQUEST_ID_PATTERN.test(value);
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

export function validatePublicSongBrowseQuery(
  searchParams: URLSearchParams,
): ValidationResult<PublicSongBrowseQuery> {
  const issues: ValidationIssue[] = [];
  const searchValidation = validateSearchQuery(searchParams.get("q"));
  if (!searchValidation.success) issues.push(...searchValidation.issues);

  const limit = parseBrowseLimit(searchParams.get("limit"), issues);
  const genre = parseBrowseCategory(searchParams.get("genre"), "genre", issues);
  const language = parseBrowseCategory(
    searchParams.get("language"),
    "language",
    issues,
  );
  const duet = parseBrowseFlag(searchParams.get("duet"), "duet", issues);
  const hit = parseBrowseFlag(searchParams.get("hit"), "hit", issues);
  const sort = parseBrowseSort(searchParams.get("sort"), issues);

  if (issues.length > 0 || !searchValidation.success) {
    return { success: false, issues };
  }

  const query = {
    cursor: null,
    limit,
    q: searchValidation.data,
    genre,
    language,
    duet,
    hit,
    sort,
  } satisfies Omit<PublicSongBrowseQuery, "cursor"> & { cursor: null };
  const cursor = parseSongBrowseCursor(
    searchParams.get("cursor"),
    getSongBrowseFilterKey(query),
    sort,
  );

  if (!cursor.success) return cursor;

  return {
    success: true,
    data: {
      ...query,
      cursor: cursor.data,
    },
  };
}

export function encodeSongBrowseCursor(cursor: SongBrowseCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function getSongBrowseFilterKey(
  query: Omit<PublicSongBrowseQuery, "cursor">,
) {
  return JSON.stringify({
    q: query.q,
    genre: query.genre,
    language: query.language,
    duet: query.duet,
    hit: query.hit,
    sort: query.sort,
  });
}

function parseBrowseLimit(input: string | null, issues: ValidationIssue[]) {
  if (input === null || input === "") return PUBLIC_SONG_BROWSE_DEFAULT_LIMIT;

  if (!/^[1-9]\d*$/.test(input)) {
    issues.push({ field: "limit", message: "limit must be a positive integer." });
    return PUBLIC_SONG_BROWSE_DEFAULT_LIMIT;
  }

  const limit = Number(input);
  if (!Number.isSafeInteger(limit)) {
    issues.push({ field: "limit", message: "limit must be a positive integer." });
    return PUBLIC_SONG_BROWSE_DEFAULT_LIMIT;
  }

  return Math.min(limit, PUBLIC_SONG_BROWSE_MAX_LIMIT);
}

function parseBrowseCategory(
  input: string | null,
  field: "genre" | "language",
  issues: ValidationIssue[],
) {
  const value = input?.trim() ?? "";
  if (!value) return null;

  if (value.length > 100 || /[\u0000-\u001F]/.test(value)) {
    issues.push({
      field,
      message: `${field} must contain at most 100 printable characters.`,
    });
    return null;
  }

  return value.toLocaleLowerCase("en-US");
}

function parseBrowseFlag(
  input: string | null,
  field: "duet" | "hit",
  issues: ValidationIssue[],
) {
  if (input === null || input === "" || input === "false") return false;
  if (input === "true") return true;

  issues.push({ field, message: `${field} must be true or false.` });
  return false;
}

function parseBrowseSort(
  input: string | null,
  issues: ValidationIssue[],
): SongBrowseSort {
  if (input === null || input === "" || input === "title") return "title";
  if (input === "artist" || input === "newest") return input;

  issues.push({ field: "sort", message: "sort is not supported." });
  return "title";
}

function parseSongBrowseCursor(
  input: string | null,
  expectedFilterKey: string,
  expectedSort: SongBrowseSort,
): ValidationResult<SongBrowseCursor | null> {
  if (input === null || input === "") {
    return { success: true, data: null };
  }

  if (input.length > 1_024 || !/^[A-Za-z0-9_-]+$/.test(input)) {
    return invalidBrowseCursor();
  }

  try {
    const decoded = JSON.parse(Buffer.from(input, "base64url").toString("utf8"));
    if (!isRecord(decoded) || decoded.version !== 1) return invalidBrowseCursor();
    if (
      decoded.filterKey !== expectedFilterKey ||
      decoded.sort !== expectedSort ||
      !isPositiveSafeInteger(decoded.id)
    ) {
      return invalidBrowseCursor();
    }

    if (decoded.sort === "title" || decoded.sort === "artist") {
      if (
        !isCursorText(decoded.normalizedTitle) ||
        !isCursorText(decoded.normalizedArtist)
      ) {
        return invalidBrowseCursor();
      }

      return {
        success: true,
        data: {
          version: 1,
          filterKey: decoded.filterKey,
          sort: decoded.sort,
          id: decoded.id,
          normalizedTitle: decoded.normalizedTitle,
          normalizedArtist: decoded.normalizedArtist,
        },
      };
    }

    if (
      decoded.sort === "newest" &&
      typeof decoded.createdAt === "string" &&
      !Number.isNaN(Date.parse(decoded.createdAt))
    ) {
      return {
        success: true,
        data: {
          version: 1,
          filterKey: decoded.filterKey,
          sort: "newest",
          id: decoded.id,
          createdAt: decoded.createdAt,
        },
      };
    }
  } catch {
    // Return the same safe validation response for malformed cursors.
  }

  return invalidBrowseCursor();
}

function invalidBrowseCursor(): ValidationResult<never> {
  return {
    success: false,
    issues: [{ field: "cursor", message: "cursor is invalid." }],
  };
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isCursorText(value: unknown): value is string {
  return typeof value === "string" && value.length <= 300;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
