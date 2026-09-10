import "server-only";

import { PublicApiError } from "../public-api/errors";
import { traceServerStep } from "../runtime-diagnostics";
import { requireSessionApiRateLimit } from "./rate-limit";
import { resolveJoinCode } from "./service";

const redirectHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function resolveJoinCodeResponse(request: Request, code: string) {
  try {
    requireSessionApiRateLimit(request);
    const result = await traceServerStep(
      "session.code",
      "resolveJoinCode",
      () => resolveJoinCode(code),
    );

    return temporaryNoStoreRedirect(
      result.status === "resolved"
        ? `/s/${result.publicToken}`
        : "/join?joinError=invalid",
    );
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 429) {
      return temporaryNoStoreRedirect("/join?joinError=rate-limited");
    }

    return temporaryNoStoreRedirect("/join?joinError=unavailable");
  }
}

function temporaryNoStoreRedirect(location: string) {
  return new Response(null, {
    status: 307,
    headers: { ...redirectHeaders, Location: location },
  });
}
