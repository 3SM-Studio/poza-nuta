import "server-only";

import { parseCanonicalSiteOrigin } from "../../lib/canonical-site-origin.ts";

export type ParticipantMutationOriginEnvironment = {
  SITE_URL: string | undefined;
  VERCEL_ENV: string | undefined;
  VERCEL_URL: string | undefined;
  VERCEL_BRANCH_URL: string | undefined;
};

type ParticipantMutationRequestOrigin = {
  origin: string | null;
  requestUrl: string;
  host: string | null;
};

export function resolveParticipantMutationAllowedOrigins(
  environment: ParticipantMutationOriginEnvironment,
) {
  const allowedOrigins = new Set([
    parseCanonicalSiteOrigin(environment.SITE_URL),
  ]);

  if (environment.VERCEL_ENV !== "preview") {
    return allowedOrigins;
  }

  for (const value of [
    environment.VERCEL_URL,
    environment.VERCEL_BRANCH_URL,
  ]) {
    const previewOrigin = parseVercelPreviewOrigin(value);
    if (previewOrigin) allowedOrigins.add(previewOrigin);
  }

  return allowedOrigins;
}

export function isParticipantMutationRequestOriginAllowed(
  requestOrigin: ParticipantMutationRequestOrigin,
  allowedOrigins: ReadonlySet<string>,
) {
  if (!requestOrigin.origin || !requestOrigin.host) return false;

  try {
    const origin = new URL(requestOrigin.origin).origin;
    const requestUrlOrigin = new URL(requestOrigin.requestUrl).origin;
    const host = requestOrigin.host.toLowerCase();

    for (const allowedOrigin of allowedOrigins) {
      const allowedUrl = new URL(allowedOrigin);
      if (
        origin === allowedOrigin &&
        requestUrlOrigin === allowedOrigin &&
        host === allowedUrl.host.toLowerCase()
      ) {
        return true;
      }
    }
  } catch {
    // Malformed request origins are rejected by the caller's safe error path.
  }

  return false;
}

function parseVercelPreviewOrigin(value: string | undefined) {
  const hostname = value?.trim();
  if (!hostname) return null;

  try {
    const url = new URL(`https://${hostname}`);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.pathname !== "/" ||
      !url.hostname.endsWith(".vercel.app")
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}
