import type { NextRequest } from "next/server";
import { getEventParticipant } from "@/server/operator-api/event-participants";
import { runEventParticipantRoute, type EventParticipantRouteContext } from "@/server/operator-api/event-participants-http";
import { OperatorApiError } from "@/server/operator-api/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest, context: EventParticipantRouteContext) {
  return runEventParticipantRoute(request, context, (scope, participantId) => {
    if (participantId === null) throw new OperatorApiError(400, "VALIDATION_ERROR", "Participant identifier is required.");
    return getEventParticipant({ ...scope, participantId });
  });
}
