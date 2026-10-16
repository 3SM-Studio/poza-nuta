import type { NextRequest } from "next/server";
import { previewFairEventQueue, applyFairEventQueue } from "@/server/operator-api/fair-queue";
import { runEventParticipantRoute, type EventParticipantRouteContext } from "@/server/operator-api/event-participants-http";
import { readIdentityBody } from "@/server/session-api/identity-http";
import { OperatorApiError } from "@/server/operator-api/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, context: EventParticipantRouteContext) {
  return runEventParticipantRoute(request, context, async scope => {
    const body = await readIdentityBody(request);
    if (body.action === "preview" && Object.keys(body).length === 1) return previewFairEventQueue(scope);
    if (body.action === "apply" && typeof body.revision === "string" && /^[a-f0-9]{64}$/.test(body.revision) && Object.keys(body).length === 2) {
      return applyFairEventQueue({ ...scope, revision: body.revision });
    }
    throw new OperatorApiError(400, "VALIDATION_ERROR", "Invalid fair queue operation.");
  });
}
