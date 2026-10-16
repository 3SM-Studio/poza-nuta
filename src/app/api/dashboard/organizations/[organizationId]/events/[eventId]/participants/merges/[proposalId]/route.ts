import type { NextRequest } from "next/server";
import { runEventParticipantRoute } from "@/server/operator-api/event-participants-http";
import { completeParticipantMerge, getParticipantMergeProposal } from "@/server/operator-api/participant-merge";
import { invalidBody, readIdentityBody, requireIdentityKeys } from "@/server/session-api/identity-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string; eventId: string; proposalId: string }> };
export async function GET(request: NextRequest, context: Context) {
  return runEventParticipantRoute(request, context, async scope => getParticipantMergeProposal({ ...scope, proposalId: (await context.params).proposalId }));
}
export async function POST(request: NextRequest, context: Context) {
  return runEventParticipantRoute(request, context, async scope => {
    const body = await readIdentityBody(request);
    requireIdentityKeys(body, ["action"]);
    if (body.action !== "complete" && body.action !== "cancel") throw invalidBody();
    return completeParticipantMerge({ ...scope, proposalId: (await context.params).proposalId, action: body.action });
  });
}
