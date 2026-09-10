import type { NextRequest } from "next/server";

import { jsonResponse, publicApiErrorResponse } from "@/server/public-api/responses";
import { requireParticipantMutationRequest } from "@/server/session-api/http";
import { PARTICIPANT_CREDENTIAL_COOKIE } from "@/server/session-api/participant-credential";
import { requireSessionApiRateLimit } from "@/server/session-api/rate-limit";
import { cancelPublicParticipantRequest } from "@/server/session-api/service";
import { isPublicRequestId } from "@/server/session-api/validation";
import { PublicApiError } from "@/server/public-api/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ token: string; requestId: string }> },
) {
  try {
    requireSessionApiRateLimit(request);
    requireParticipantMutationRequest(request);
    const { token, requestId } = await context.params;
    if (!isPublicRequestId(requestId)) {
      throw new PublicApiError(404, "SESSION_REQUEST_NOT_FOUND", "The request does not exist.");
    }
    const cancelledRequest = await cancelPublicParticipantRequest(
      token,
      request.cookies.get(PARTICIPANT_CREDENTIAL_COOKIE)?.value,
      requestId,
    );
    return jsonResponse({ request: cancelledRequest });
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
