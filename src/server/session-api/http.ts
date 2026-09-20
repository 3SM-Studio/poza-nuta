import "server-only";

import type { NextRequest } from "next/server";

import {
  CanonicalSiteOriginConfigurationError,
} from "../../lib/canonical-site-origin.ts";
import { PublicApiError } from "../public-api/errors.ts";
import {
  isParticipantMutationRequestOriginAllowed,
  resolveParticipantMutationAllowedOrigins,
} from "./participant-mutation-origin.ts";

export function requireParticipantMutationRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new PublicApiError(
      415,
      "SESSION_CONTENT_TYPE_UNSUPPORTED",
      "The request must use application/json.",
    );
  }

  const allowedOrigins = getParticipantMutationAllowedOrigins();
  if (
    isParticipantMutationRequestOriginAllowed(
      {
        origin: request.headers.get("origin"),
        requestUrl: request.url,
        host: request.headers.get("host"),
      },
      allowedOrigins,
    )
  ) {
    return;
  }

  throw new PublicApiError(
    403,
    "SESSION_ORIGIN_INVALID",
    "The request could not be completed.",
  );
}

function getParticipantMutationAllowedOrigins() {
  try {
    return resolveParticipantMutationAllowedOrigins({
      SITE_URL: process.env.SITE_URL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      VERCEL_URL: process.env.VERCEL_URL,
      VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
    });
  } catch (error) {
    if (!(error instanceof CanonicalSiteOriginConfigurationError)) throw error;
  }

  throw new PublicApiError(
    503,
    "SESSION_CONFIGURATION_ERROR",
    "The session is not configured.",
  );
}
