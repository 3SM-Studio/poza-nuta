import type { NextRequest } from "next/server";
import { runEventParticipantRoute, type EventParticipantRouteContext } from "@/server/operator-api/event-participants-http";
import { createParticipantMergeProposal } from "@/server/operator-api/participant-merge";
import { invalidBody, readIdentityBody, requireIdentityKeys } from "@/server/session-api/identity-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: NextRequest, context: EventParticipantRouteContext) {
  return runEventParticipantRoute(request, context, async scope => {
    const body = await readIdentityBody(request);
    requireIdentityKeys(body, ["sourceId", "targetId"]);
    if (typeof body.sourceId !== "number" || typeof body.targetId !== "number") throw invalidBody();
    return createParticipantMergeProposal({ ...scope, sourceId: body.sourceId, targetId: body.targetId });
  }, 201);
}
