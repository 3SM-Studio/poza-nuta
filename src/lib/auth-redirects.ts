export const DEFAULT_AUTH_NEXT_PATH = "/dashboard";

const LOCAL_SAFE_AUTH_ORIGIN = "https://poza-nuta.local";

export class AuthRedirectConfigurationError extends Error {
  constructor() {
    super("Authentication redirect configuration is invalid.");
    this.name = "AuthRedirectConfigurationError";
  }
}

export function getSafeDashboardAuthNextPath(
  value: string | null | undefined,
  fallback = DEFAULT_AUTH_NEXT_PATH,
) {
  if (!value) {
    return fallback;
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  try {
    const parsed = new URL(value, LOCAL_SAFE_AUTH_ORIGIN);

    if (parsed.origin !== LOCAL_SAFE_AUTH_ORIGIN) {
      return fallback;
    }

    const nextPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;

    if (nextPath === "/dashboard" || nextPath.startsWith("/dashboard/")) {
      return nextPath;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export function getAuthRedirectOrigin(requestOrigin: string) {
  const configuredSiteUrl = process.env.SITE_URL?.trim();

  if (configuredSiteUrl) {
    const normalizedOrigin = normalizeHttpOrigin(configuredSiteUrl);

    if (!normalizedOrigin) {
      throw new AuthRedirectConfigurationError();
    }

    return normalizedOrigin;
  }

  return requestOrigin;
}

export function buildAuthCallbackRedirectTo(
  origin: string,
  next = DEFAULT_AUTH_NEXT_PATH,
) {
  const normalizedOrigin = normalizeHttpOrigin(origin);
  const callbackUrl = new URL("/auth/callback", normalizedOrigin ?? origin);

  callbackUrl.searchParams.set("next", getSafeDashboardAuthNextPath(next));

  return callbackUrl.toString();
}

function normalizeHttpOrigin(value: string) {
  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}
