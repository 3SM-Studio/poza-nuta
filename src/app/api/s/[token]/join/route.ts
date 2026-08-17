import { NextResponse, type NextRequest } from "next/server";

import {
  invalidJsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "@/server/public-api/responses";
import { requireParticipantMutationRequest } from "@/server/session-api/http";
import {
  PARTICIPANT_CREDENTIAL_COOKIE,
  setParticipantCredentialCookie,
} from "@/server/session-api/participant-credential";
import { requireSessionApiRateLimit } from "@/server/session-api/rate-limit";
import { joinPublicSession } from "@/server/session-api/service";
import { validateParticipantJoinInput } from "@/server/session-api/validation";

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

    const validation = validateParticipantJoinInput(body);
    if (!validation.success) return validationErrorResponse(validation.issues);

    const { token } = await context.params;
    const result = await joinPublicSession(
      token,
      request.cookies.get(PARTICIPANT_CREDENTIAL_COOKIE)?.value,
      validation.data,
    );
    const response = NextResponse.json(
      { participant: result.participant },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
    setParticipantCredentialCookie(
      response,
      result.credential,
      result.credentialExpiresAt,
    );
    return response;
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
