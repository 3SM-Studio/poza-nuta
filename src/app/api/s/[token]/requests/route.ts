import type { NextRequest } from "next/server";

import {
  invalidJsonResponse,
  jsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "@/server/public-api/responses";
import { requireSessionApiRateLimit } from "@/server/session-api/rate-limit";
import { createPublicSessionRequest } from "@/server/session-api/service";
import { requireParticipantMutationRequest } from "@/server/session-api/http";
import { PARTICIPANT_CREDENTIAL_COOKIE } from "@/server/session-api/participant-credential";
import { validateParticipantSessionRequestInput } from "@/server/session-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    requireSessionApiRateLimit(request);
    requireParticipantMutationRequest(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return invalidJsonResponse();
    }

    const validation = validateParticipantSessionRequestInput(body);
    if (!validation.success) return validationErrorResponse(validation.issues);

    const { token } = await context.params;
    const createdRequest = await createPublicSessionRequest(
      token,
      request.cookies.get(PARTICIPANT_CREDENTIAL_COOKIE)?.value,
      validation.data,
    );
    return jsonResponse({ request: createdRequest }, 201);
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
