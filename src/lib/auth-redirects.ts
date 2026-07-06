export const DEFAULT_AUTH_NEXT_PATH = "/dashboard";

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
    const parsed = new URL(value, "https://poza-nuta.local");

    if (parsed.origin !== "https://poza-nuta.local") {
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

export function buildAuthCallbackRedirectTo(
  origin: string,
  next = DEFAULT_AUTH_NEXT_PATH,
) {
  const callbackUrl = new URL("/auth/callback", origin);

  callbackUrl.searchParams.set("next", getSafeDashboardAuthNextPath(next));

  return callbackUrl.toString();
}
