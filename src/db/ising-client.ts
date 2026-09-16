export type ISingApiSong = {
  id?: number | string | null;
  song_id?: number | string | null;
  songId?: number | string | null;
  title?: string | null;
  subtitle?: string | null;
  artist?: string | null;
  genre?: unknown;
  duration?: number | string | null;
  hit?: unknown;
  plus?: unknown;
  permalink?: string | null;
  links?: {
    permalink?: unknown;
    selflink?: unknown;
  } | null;
};

export type ISingSearchResponse = {
  data: {
    found?: number;
    q?: string;
    results: {
      songs: unknown[];
    };
  };
  links?: {
    next?: string;
    last?: string;
  };
};

export type ISingSearchFilter = {
  tag?: string;
  lang?: string;
};

export type ISingClientOptions = ISingSearchFilter & {
  apiBaseUrl: string;
  clientId: string;
  order: string;
  timeoutMs: number;
  userAgent?: string;
  fetchFn?: typeof fetch;
};

export const defaultISingSearchLimit = 50;

const CHALLENGE_TEXTS = [
  "Potwierdzenie dostępu",
  "Trwa automatyczna weryfikacja",
  "Weryfikacja nie powiodła się",
  "Spróbuj ponownie",
];

const FORBIDDEN_KEYS = new Set([
  "audio",
  "audio_url",
  "comments",
  "download_url",
  "files",
  "lyrics",
  "media_url",
  "profiles",
  "recording",
  "recordings",
  "text",
  "users",
]);

export class ISingImportSafetyError extends Error {
  readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.name = "ISingImportSafetyError";
    this.url = toSafeISingRequestReference(url);
  }
}

export class ISingHttpError extends ISingImportSafetyError {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(status: number, url: string, retryAfterMs: number | null = null) {
    super(`HTTP ${status} from iSing`, url);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function buildISingInitialSearchUrl(options: ISingClientOptions) {
  const url = new URL(`${options.apiBaseUrl.replace(/\/$/, "")}/search`);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("q", "");
  url.searchParams.set("tag", normalizeFilterValue(options.tag));
  url.searchParams.set("limit", String(defaultISingSearchLimit));
  url.searchParams.set("order", options.order);
  url.searchParams.set("scope", "songs");

  const lang = normalizeFilterValue(options.lang);
  if (lang) url.searchParams.set("lang", lang);

  return url.toString();
}

export function resolveISingNextUrl(
  nextUrl: string,
  options: Pick<ISingClientOptions, "apiBaseUrl" | "clientId">,
) {
  const apiBaseUrl = new URL(options.apiBaseUrl);
  const expectedPath = `${apiBaseUrl.pathname.replace(/\/$/, "")}/search`;
  let resolved: URL;

  try {
    resolved = new URL(nextUrl, `${options.apiBaseUrl.replace(/\/$/, "")}/`);
  } catch {
    throw new ISingImportSafetyError(
      "Invalid iSing pagination URL",
      nextUrl,
    );
  }

  if (
    resolved.origin !== apiBaseUrl.origin ||
    resolved.pathname !== expectedPath
  ) {
    throw new ISingImportSafetyError(
      "Unexpected iSing pagination URL",
      nextUrl,
    );
  }

  resolved.searchParams.set("client_id", options.clientId);
  return resolved.toString();
}

export async function fetchISingSearchPage(
  url: string,
  options: ISingClientOptions,
) {
  const fetchFn = options.fetchFn ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
  const headers: Record<string, string> = {
    accept: "application/json",
  };

  if (options.userAgent) {
    headers["user-agent"] = options.userAgent;
  }

  try {
    const response = await fetchFn(url, {
      headers,
      signal: controller.signal,
    });

    return readAndValidateISingResponse(response, url);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function readAndValidateISingResponse(
  response: Response,
  url: string,
  now = Date.now(),
) {
  if (response.status === 403 || response.status === 429) {
    throw new ISingHttpError(
      response.status,
      url,
      response.status === 429
        ? parseRetryAfter(response.headers.get("retry-after"), now)
        : null,
    );
  }

  if (!response.ok) {
    throw new ISingHttpError(response.status, url);
  }

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  validateRawISingResponseText(text, contentType, url);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ISingImportSafetyError("Invalid JSON response from iSing", url);
  }

  validateISingSearchResponse(parsed, url);
  return parsed;
}

export function isRetryableISingRequestError(error: unknown): boolean {
  if (error instanceof ISingHttpError) {
    return [408, 425, 429].includes(error.status) || error.status >= 500;
  }
  return error instanceof TypeError ||
    (error instanceof Error && error.name === "AbortError");
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) ? seconds * 1_000 : null;
  }
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export function validateRawISingResponseText(
  text: string,
  contentType: string,
  url: string,
) {
  const trimmed = text.trimStart().toLowerCase();
  const looksLikeHtml =
    contentType.toLowerCase().includes("text/html") ||
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html");

  if (looksLikeHtml) {
    throw new ISingImportSafetyError(
      "HTML verification/challenge page instead of JSON",
      url,
    );
  }

  const challengeText = CHALLENGE_TEXTS.find((value) => text.includes(value));
  if (challengeText) {
    throw new ISingImportSafetyError(
      `HTML verification/challenge page: ${challengeText}`,
      url,
    );
  }
}

function validateISingSearchResponse(
  value: unknown,
  url: string,
): asserts value is ISingSearchResponse {
  assertNoForbiddenFields(value, url);

  if (!isRecord(value) || !isRecord(value.data)) {
    throw new ISingImportSafetyError("Invalid iSing response: missing data", url);
  }

  if (!isRecord(value.data.results)) {
    throw new ISingImportSafetyError(
      "Invalid iSing response: missing data.results",
      url,
    );
  }

  if (!Array.isArray(value.data.results.songs)) {
    throw new ISingImportSafetyError(
      "Invalid iSing response: data.results.songs is not an array",
      url,
    );
  }
}

function assertNoForbiddenFields(
  value: unknown,
  url: string,
  path: string[] = [],
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoForbiddenFields(item, url, path);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const currentPath = [...path, key];

    if (
      isSafeCountField(normalizedKey) ||
      normalizedKey.endsWith("_count")
    ) {
      continue;
    }

    if (
      FORBIDDEN_KEYS.has(normalizedKey) ||
      normalizedKey.includes("email") ||
      normalizedKey.includes("token")
    ) {
      throw new ISingImportSafetyError(
        `Unexpected private/sensitive iSing field: ${currentPath.join(".")}`,
        url,
      );
    }

    assertNoForbiddenFields(nestedValue, url, currentPath);
  }
}

function isSafeCountField(key: string) {
  return (
    key === "recordings_count" ||
    key === "comments_count" ||
    key === "views_count" ||
    key === "likes_count"
  );
}

function normalizeFilterValue(value: string | undefined) {
  return value?.trim() ?? "";
}

function toSafeISingRequestReference(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "iSing request";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
