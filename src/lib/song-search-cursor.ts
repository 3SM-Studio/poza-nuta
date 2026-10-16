export type SongSearchCursor = {
  version: 1 | 2;
  query: string;
  relevanceTier: number;
  fuzzyRelevance: number;
  normalizedArtist: string;
  normalizedTitle: string;
  source: "ising" | "karafun" | "manual";
  id: number;
};

export function encodeSongSearchCursor(cursor: SongSearchCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeSongSearchCursor(
  input: string,
  expectedQuery: string,
  expectedVersion: 1 | 2 = 1,
): SongSearchCursor | null {
  // NFD keys and UTF-8 alphabets expand beyond the former ASCII byte bound.
  if (input.length === 0 || input.length > 8_192 || !/^[A-Za-z0-9_-]+$/.test(input)) {
    return null;
  }

  try {
    const value = JSON.parse(Buffer.from(input, "base64url").toString("utf8")) as unknown;
    if (!isRecord(value)) return null;
    if (
      value.version !== expectedVersion ||
      value.query !== expectedQuery ||
      !Number.isSafeInteger(value.relevanceTier) ||
      typeof value.fuzzyRelevance !== "number" ||
      !Number.isFinite(value.fuzzyRelevance) ||
      value.fuzzyRelevance < 0 ||
      value.fuzzyRelevance > 1 ||
      !isCursorText(value.normalizedArtist) ||
      !isCursorText(value.normalizedTitle) ||
      !isSongSource(value.source) ||
      !Number.isSafeInteger(value.id) ||
      (value.id as number) <= 0
    ) {
      return null;
    }

    return value as SongSearchCursor;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCursorText(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1200;
}

function isSongSource(value: unknown): value is SongSearchCursor["source"] {
  return value === "ising" || value === "karafun" || value === "manual";
}
