import "server-only";

import { PublicApiError } from "../public-api/errors";
import {
  consumeSessionRateLimit,
  type SessionRateLimitScope,
} from "./rate-limit-core";

export function consumeSessionRequestRateLimit(
  headers: Pick<Headers, "get">,
  scope: SessionRateLimitScope,
) {
  return consumeSessionRateLimit({ scope, key: getClientKey(headers) });
}

export function requireSessionApiRateLimit(request: Request) {
  const result = consumeSessionRequestRateLimit(request.headers, "api");

  if (!result.allowed) {
    throw new PublicApiError(
      429,
      "SESSION_RATE_LIMITED",
      "The session could not be opened.",
    );
  }
}

function getClientKey(headers: Pick<Headers, "get">) {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || headers.get("x-real-ip")?.trim() || "unknown";
}
