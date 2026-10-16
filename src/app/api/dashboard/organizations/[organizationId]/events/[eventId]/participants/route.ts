import type { NextRequest } from "next/server";
import { createEventParticipant, listEventParticipants } from "@/server/operator-api/event-participants";
import { readParticipantBody, runEventParticipantRoute, type EventParticipantRouteContext } from "@/server/operator-api/event-participants-http";
import { OperatorApiError } from "@/server/operator-api/errors";
import { validateParticipantJoinInput } from "@/server/session-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest, context: EventParticipantRouteContext) {
  return runEventParticipantRoute(request, context, (scope) => listEventParticipants(scope));
}

export function POST(request: NextRequest, context: EventParticipantRouteContext) {
  return runEventParticipantRoute(request, context, async (scope) => {
    const body = await readParticipantBody(request);
    const validation = validateParticipantJoinInput(body);
    if (!validation.success || !body || typeof body !== "object" || Object.keys(body).some((key) => key !== "displayName")) {
      throw new OperatorApiError(400, "VALIDATION_ERROR", "Only a valid participant nickname is accepted.");
    }
    return createEventParticipant({ ...scope, displayName: validation.data.displayName });
  }, 201);
}
