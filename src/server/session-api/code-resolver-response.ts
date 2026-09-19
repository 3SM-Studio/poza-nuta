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
  const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;

  try {
    requireSessionApiRateLimit(request);
    const result = await traceServerStep(
      "session.code",
      "resolveJoinCode",
      () => resolveJoinCode(code),
    );

    if (result.status === "resolved") {
      const location = `/s/${result.publicToken}`;
      return wantsJson
        ? noStoreJson({ status: "resolved", location }, 200)
        : temporaryNoStoreRedirect(location);
    }

    return wantsJson
      ? noStoreJson({ status: "error", error: "invalid" }, 404)
      : temporaryNoStoreRedirect("/join?joinError=invalid");
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 429) {
      return wantsJson
        ? noStoreJson({ status: "error", error: "rate-limited" }, 429)
        : temporaryNoStoreRedirect("/join?joinError=rate-limited");
    }

    return wantsJson
      ? noStoreJson({ status: "error", error: "unavailable" }, 503)
      : temporaryNoStoreRedirect("/join?joinError=unavailable");
  }
}

function noStoreJson(body: object, status: number) {
  return Response.json(body, { status, headers: redirectHeaders });
}

function temporaryNoStoreRedirect(location: string) {
  return new Response(null, {
    status: 307,
    headers: { ...redirectHeaders, Location: location },
  });
}
