import type { NextRequest } from "next/server";
import { runEventParticipantRoute, type EventParticipantRouteContext } from "@/server/operator-api/event-participants-http";
import { listEventParticipantPresence } from "@/server/operator-api/event-participants";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: EventParticipantRouteContext) {
  return runEventParticipantRoute(request, context, listEventParticipantPresence);
}
