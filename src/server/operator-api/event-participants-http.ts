import "server-only";

import type { NextRequest } from "next/server";
import { PublicApiError } from "../public-api/errors";
import { publicApiErrorResponse } from "../public-api/responses";
import { requireParticipantMutationRequest } from "../session-api/http";
import { requireOperatorSession } from "./supabase-session";
import { OperatorApiError } from "./errors";
import { operatorApiErrorResponse, operatorJsonResponse } from "./responses";
import { validateDashboardEventIdentifier, validateRequestId } from "./validation";
import type { EventParticipantScope } from "./event-participants";

export type EventParticipantRouteContext = {
  params: Promise<{ organizationId: string; eventId: string; participantId?: string }>;
};

export async function runEventParticipantRoute(
  request: NextRequest,
  context: EventParticipantRouteContext,
  handler: (scope: EventParticipantScope, participantId: number | null) => Promise<unknown>,
  status = 200,
) {
  try {
    const session = await requireOperatorSession();
    if (request.method === "POST") requireParticipantMutationRequest(request);
    const params = await context.params;
    const event = validateDashboardEventIdentifier(params.eventId);
    const participant = params.participantId === undefined ? null : validateRequestId(params.participantId);
    if (!event.success || (participant && !participant.success)) {
      throw new OperatorApiError(400, "VALIDATION_ERROR", "Invalid event or participant identifier.");
    }
    return operatorJsonResponse(await handler({
      authUserId: session.authUser.id, organizationId: params.organizationId, eventId: event.data,
    }, participant?.success ? participant.data : null), status);
  } catch (error) {
    if (error instanceof PublicApiError) return publicApiErrorResponse(error);
    return operatorApiErrorResponse(error);
  }
}

export async function readParticipantBody(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { throw new OperatorApiError(400, "INVALID_JSON", "Request body must contain valid JSON."); }
  return body;
}
