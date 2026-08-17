import type { NextRequest } from "next/server";

import {
  invalidJsonResponse,
  jsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "@/server/public-api/responses";
import { requireParticipantMutationRequest } from "@/server/session-api/http";
import { PARTICIPANT_CREDENTIAL_COOKIE } from "@/server/session-api/participant-credential";
import { requireSessionApiRateLimit } from "@/server/session-api/rate-limit";
import {
  getPublicSessionParticipant,
  renamePublicSessionParticipant,
} from "@/server/session-api/service";
import { validateParticipantRenameInput } from "@/server/session-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    requireSessionApiRateLimit(request);
    const { token } = await context.params;
    const participant = await getPublicSessionParticipant(
      token,
      request.cookies.get(PARTICIPANT_CREDENTIAL_COOKIE)?.value,
    );
    return jsonResponse({ participant });
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}

export async function PATCH(
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
    const validation = validateParticipantRenameInput(body);
    if (!validation.success) return validationErrorResponse(validation.issues);
    const { token } = await context.params;
    const participant = await renamePublicSessionParticipant(
      token,
      request.cookies.get(PARTICIPANT_CREDENTIAL_COOKIE)?.value,
      validation.data,
    );
    return jsonResponse({ participant });
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
