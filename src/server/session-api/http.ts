import "server-only";

import type { NextRequest } from "next/server";

import {
  CanonicalSiteOriginConfigurationError,
  parseCanonicalSiteOrigin,
} from "../../lib/canonical-site-origin.ts";
import { PublicApiError } from "../public-api/errors.ts";

export function requireParticipantMutationRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new PublicApiError(
      415,
      "SESSION_CONTENT_TYPE_UNSUPPORTED",
      "The request must use application/json.",
    );
  }

  const expectedOrigin = getPublicSiteOrigin();
  const origin = request.headers.get("origin");
  const host = request.headers.get("host")?.toLowerCase();

  try {
    if (
      origin &&
      new URL(origin).origin === expectedOrigin &&
      new URL(request.url).origin === expectedOrigin &&
      host === new URL(expectedOrigin).host.toLowerCase()
    ) {
      return;
    }
  } catch {
    // Return the same safe failure for malformed or mismatched inputs.
  }

  throw new PublicApiError(
    403,
    "SESSION_ORIGIN_INVALID",
    "The request could not be completed.",
  );
}

function getPublicSiteOrigin() {
  try {
    return parseCanonicalSiteOrigin(process.env.SITE_URL);
  } catch (error) {
    if (!(error instanceof CanonicalSiteOriginConfigurationError)) throw error;
  }

  throw new PublicApiError(
    503,
    "SESSION_CONFIGURATION_ERROR",
    "The session is not configured.",
  );
}
