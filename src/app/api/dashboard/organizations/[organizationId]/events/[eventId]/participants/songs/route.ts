import type { NextRequest } from "next/server";
import { searchEventParticipantSongs } from "@/server/operator-api/event-participants";
import { runEventParticipantRoute, type EventParticipantRouteContext } from "@/server/operator-api/event-participants-http";
import { OperatorApiError } from "@/server/operator-api/errors";
import { validateSearchQuery } from "@/server/public-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest, context: EventParticipantRouteContext) {
  return runEventParticipantRoute(request, context, async (scope) => {
    const validation = validateSearchQuery(request.nextUrl.searchParams.get("q"));
    if (!validation.success) throw new OperatorApiError(400, "VALIDATION_ERROR", "Invalid search query.");
    return searchEventParticipantSongs({ ...scope, query: validation.data });
  });
}
