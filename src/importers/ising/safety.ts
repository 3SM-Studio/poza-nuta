import type { ISingSearchResponse } from "./types.ts";

const CHALLENGE_TEXTS = [
  "Potwierdzenie dostępu",
  "Trwa automatyczna weryfikacja",
  "Weryfikacja nie powiodła się",
  "Spróbuj ponownie"
];

const EXACT_FORBIDDEN_KEYS = new Set(["lyrics", "audio", "user"]);

export class ISingSafetyStopError extends Error {
  readonly url: string;
  readonly reason: string;

  constructor(reason: string, url: string) {
    super(reason);
    this.name = "ISingSafetyStopError";
    this.reason = reason;
    this.url = url;
  }
}

export async function readAndValidateISingResponse(response: Response, url: string): Promise<ISingSearchResponse> {
  if (response.status === 403) {
    throw new ISingSafetyStopError("HTTP 403 forbidden", url);
  }

  if (response.status === 429) {
    throw new ISingSafetyStopError("HTTP 429 rate limit", url);
  }

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  validateRawResponseText(text, contentType, url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from iSing`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ISingSafetyStopError("Invalid JSON response", url);
  }

  validateISingSearchResponse(parsed, url);
  return parsed;
}

export function validateRawResponseText(text: string, contentType: string, url: string): void {
  const trimmed = text.trimStart();
  const looksLikeHtml = contentType.toLowerCase().includes("text/html") || trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");

  if (looksLikeHtml) {
    throw new ISingSafetyStopError("HTML verification/challenge page instead of JSON", url);
  }

  const matchedChallengeText = CHALLENGE_TEXTS.find((challengeText) => text.includes(challengeText));
  if (matchedChallengeText) {
    throw new ISingSafetyStopError(`HTML verification/challenge page: ${matchedChallengeText}`, url);
  }
}

export function validateISingSearchResponse(value: unknown, url: string): asserts value is ISingSearchResponse {
  assertNoForbiddenPrivateFields(value, url);

  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.results)) {
    throw new ISingSafetyStopError("Invalid response shape: missing data.results", url);
  }

  if (!Array.isArray(value.data.results.songs)) {
    throw new ISingSafetyStopError("Invalid response shape: data.results.songs is not an array", url);
  }
}

function assertNoForbiddenPrivateFields(value: unknown, url: string, path: string[] = []): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoForbiddenPrivateFields(item, url, path);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const currentPath = [...path, key];

    if (EXACT_FORBIDDEN_KEYS.has(normalizedKey) || normalizedKey.includes("email") || normalizedKey.includes("token")) {
      throw new ISingSafetyStopError(`Unexpected private/sensitive field: ${currentPath.join(".")}`, url);
    }

    assertNoForbiddenPrivateFields(nestedValue, url, currentPath);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
