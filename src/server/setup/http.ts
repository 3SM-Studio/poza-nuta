import type { NextRequest } from "next/server";

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
  const siteUrl = process.env.SITE_URL?.trim();

  if (!siteUrl) {
    throw new OperatorApiError(
      503,
      "SETUP_CONFIGURATION_ERROR",
      "Setup is not configured.",
    );
  }

  try {
    const url = new URL(siteUrl);

    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin;
    }
  } catch {
    // Handled below with the same safe error.
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
