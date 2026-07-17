import type { NextRequest } from "next/server";

import {
  CanonicalSiteOriginConfigurationError,
  parseCanonicalSiteOrigin,
} from "../../lib/canonical-site-origin.ts";
import { OperatorApiError } from "../operator-api/errors.ts";

export function requireSameOriginRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  const expectedOrigin = getConfiguredSiteOrigin();

  if (!origin) {
    throw new OperatorApiError(
      403,
      "INVALID_ORIGIN",
      "The request could not be completed.",
    );
  }

  try {
    if (new URL(origin).origin === expectedOrigin) {
      return;
    }
  } catch {
    // Handled below with the same safe error.
  }

  throw new OperatorApiError(
    403,
    "INVALID_ORIGIN",
    "The request could not be completed.",
  );
}

export function getConfiguredSiteOrigin() {
  try {
    return parseCanonicalSiteOrigin(process.env.SITE_URL);
  } catch (error) {
    if (!(error instanceof CanonicalSiteOriginConfigurationError)) {
      throw error;
    }
  }

  throw new OperatorApiError(
    503,
    "SETUP_CONFIGURATION_ERROR",
    "Setup is not configured.",
  );
}

export function getRateLimitKey(request: NextRequest, suffix = "") {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";

  return suffix ? `${ip}:${suffix}` : ip;
}
