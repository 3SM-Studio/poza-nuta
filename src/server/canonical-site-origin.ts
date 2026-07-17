import "server-only";

import {
  CanonicalSiteOriginConfigurationError,
  parseCanonicalSiteOrigin,
} from "../lib/canonical-site-origin.ts";

export function getCanonicalSiteOrigin() {
  return parseCanonicalSiteOrigin(process.env.SITE_URL);
}

export function buildCanonicalSiteUrl(path: string) {
  return new URL(path, getCanonicalSiteOrigin()).toString();
}

export function tryBuildCanonicalSiteUrl(path: string) {
  try {
    return buildCanonicalSiteUrl(path);
  } catch (error) {
    if (error instanceof CanonicalSiteOriginConfigurationError) {
      return null;
    }

    throw error;
  }
}
