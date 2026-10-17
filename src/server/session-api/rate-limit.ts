import "server-only";
import { createHash } from "node:crypto";
import { hashParticipantCredential, PARTICIPANT_CREDENTIAL_COOKIE } from "./participant-credential";

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

export function requireSessionApiRateLimit(request: Request, scope: "api" | "search" = "api") {
  const result = scope === "search" ? consumeSearchRateLimit(request) : consumeSessionRequestRateLimit(request.headers, "api");

  if (!result.allowed) {
    throw new PublicApiError(
      429,
      "SESSION_RATE_LIMITED",
      "The session could not be opened.",
    );
  }
}

function consumeSearchRateLimit(request: Request) {
  const network = createHash("sha256").update(getClientKey(request.headers)).digest("hex");
  // This hint partitions a shared venue IP; it grants no authorization. Rotated
  // or fabricated cookies remain subject to the aggregate network budget.
  const cookie = request.headers.get("cookie")?.split(";").map(value => value.trim())
    .find(value => value.startsWith(`${PARTICIPANT_CREDENTIAL_COOKIE}=`))
    ?.slice(PARTICIPANT_CREDENTIAL_COOKIE.length + 1);
  const credential = hashParticipantCredential(cookie ?? "");
  const networkResult = consumeSessionRateLimit({ scope: "search-network", key: network });
  if (!networkResult.allowed) return networkResult;
  return consumeSessionRateLimit({ scope: "search", key: credential ? `credential:${credential}` : `anonymous:${network}` });
}

function getClientKey(headers: Pick<Headers, "get">) {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || headers.get("x-real-ip")?.trim() || "unknown";
}
