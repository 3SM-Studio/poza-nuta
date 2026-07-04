export type ISingSearchResponse = {
  data: {
    found?: number;
    q?: string;
    results: {
      songs: Record<string, unknown>[];
    };
  };
  links?: {
    next?: string;
    last?: string;
  };
};

export type ISingClientOptions = {
  apiBaseUrl: string;
  clientId: string;
  tag: string;
  order: string;
  timeoutMs: number;
  userAgent?: string;
  fetchFn?: typeof fetch;
};

const CHALLENGE_TEXTS = [
  "Potwierdzenie dostępu",
  "Trwa automatyczna weryfikacja",
  "Weryfikacja nie powiodła się",
  "Spróbuj ponownie",
];

const FORBIDDEN_KEYS = new Set(["audio", "lyrics", "sample_url", "user"]);

export class ISingImportSafetyError extends Error {
  readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.name = "ISingImportSafetyError";
    this.url = url;
  }
}

export function buildISingInitialSearchUrl(options: ISingClientOptions) {
  const url = new URL(`${options.apiBaseUrl.replace(/\/$/, "")}/search`);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("q", "");
  url.searchParams.set("tag", options.tag);
  url.searchParams.set("per_page", "50");
  url.searchParams.set("order", options.order);
  url.searchParams.set("scope", "songs");

  return url.toString();
}

export function resolveISingNextUrl(nextUrl: string, apiBaseUrl: string) {
  return new URL(nextUrl, `${apiBaseUrl.replace(/\/$/, "")}/`).toString();
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
) {
  if (response.status === 403) {
    throw new ISingImportSafetyError("HTTP 403 forbidden from iSing", url);
  }

  if (response.status === 429) {
    throw new ISingImportSafetyError("HTTP 429 rate limit from iSing", url);
  }

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  validateRawISingResponseText(text, contentType, url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from iSing`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ISingImportSafetyError("Invalid JSON response from iSing", url);
  }

  validateISingSearchResponse(parsed, url);
  return parsed;
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
      FORBIDDEN_KEYS.has(normalizedKey) ||
      normalizedKey.includes("email") ||
      normalizedKey.includes("token") ||
      normalizedKey.includes("recording")
    ) {
      throw new ISingImportSafetyError(
        `Unexpected private/sensitive iSing field: ${currentPath.join(".")}`,
        url,
      );
    }

    assertNoForbiddenFields(nestedValue, url, currentPath);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
