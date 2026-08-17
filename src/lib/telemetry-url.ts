const TELEMETRY_URL_ORIGIN = "https://telemetry.invalid";

// These match the public route contracts without importing server-only helpers.
const EVENT_SESSION_PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SESSION_CODE_PATTERN = /^\d{8}$/;
const SAFE_SORT_VALUES = new Set(["title", "artist", "newest"]);
const PRIVATE_PATH_PREFIXES = [
  "/dashboard",
  "/admin",
  "/sign-in",
  "/auth",
  "/setup",
  "/operator",
  "/api",
] as const;

export type TelemetryUrlEvent = {
  url: string;
};

export function redactTelemetryEvent<T extends TelemetryUrlEvent>(
  event: T,
): T | null {
  if (!shouldTrackTelemetryUrl(event.url)) return null;

  return {
    ...event,
    url: normalizeTelemetryUrl(event.url),
  };
}

export function shouldTrackTelemetryUrl(input: string) {
  const url = parseTelemetryUrl(input);
  return url !== null && !isPrivatePath(url.pathname);
}

export function normalizeTelemetryUrl(input: string) {
  const url = parseTelemetryUrl(input);
  if (url === null) return "/";

  const pathname = redactPathname(url.pathname);
  const search = redactSearchParams(url.searchParams);

  return search.length > 0 ? `${pathname}?${search}` : pathname;
}

function parseTelemetryUrl(input: string) {
  try {
    const url = new URL(input, TELEMETRY_URL_ORIGIN);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isPrivatePath(pathname: string) {
  return PRIVATE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function redactPathname(pathname: string) {
  const segments = pathname.split("/");

  if (
    segments[1] === "s" &&
    segments[2] !== undefined &&
    EVENT_SESSION_PUBLIC_TOKEN_PATTERN.test(segments[2])
  ) {
    segments[2] = "[token]";
  }

  if (
    (segments[1] === "join" || segments[1] === "session") &&
    segments[2] !== undefined &&
    SESSION_CODE_PATTERN.test(segments[2])
  ) {
    segments[2] = "[code]";
  }

  return segments.join("/") || "/";
}

function redactSearchParams(searchParams: URLSearchParams) {
  const normalizedParams: string[] = [];
  const seen = new Set<string>();

  for (const [key, value] of searchParams) {
    if (seen.has(key)) continue;
    seen.add(key);

    switch (key) {
      case "q":
        normalizedParams.push("q=[query]");
        break;
      case "genre":
        normalizedParams.push("genre=[genre]");
        break;
      case "language":
        normalizedParams.push("language=[language]");
        break;
      case "duet":
      case "hit":
        normalizedParams.push(
          `${key}=${value === "true" || value === "false" ? value : "[flag]"}`,
        );
        break;
      case "sort":
        normalizedParams.push(
          `sort=${SAFE_SORT_VALUES.has(value) ? value : "[sort]"}`,
        );
        break;
      default:
        // Unknown parameters can contain auth, token, cursor, or user-provided data.
        break;
    }
  }

  return normalizedParams.join("&");
}
