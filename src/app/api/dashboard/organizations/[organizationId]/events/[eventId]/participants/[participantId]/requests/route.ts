import type { NextRequest } from "next/server";
import { createOperatorParticipantRequest } from "@/server/operator-api/event-participants";
import { readParticipantBody, runEventParticipantRoute, type EventParticipantRouteContext } from "@/server/operator-api/event-participants-http";
import { OperatorApiError } from "@/server/operator-api/errors";
import { validateParticipantSessionRequestInput } from "@/server/session-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: NextRequest, context: EventParticipantRouteContext) {
  return runEventParticipantRoute(request, context, async (scope, participantId) => {
    const validation = validateParticipantSessionRequestInput(await readParticipantBody(request));
    if (!validation.success || participantId === null) throw new OperatorApiError(400, "VALIDATION_ERROR", "Only a catalog song identifier is accepted.");
    return createOperatorParticipantRequest({ ...scope, participantId, songId: validation.data.songId });
  }, 201);
}
