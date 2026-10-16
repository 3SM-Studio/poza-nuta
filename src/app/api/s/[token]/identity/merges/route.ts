import type { NextRequest } from "next/server";
import { requireParticipantMutationRequest } from "@/server/session-api/http";
import { invalidBody, identityErrorResponse, readIdentityBody, requireIdentityKeys, requireIdentityRateLimit } from "@/server/session-api/identity-http";
import { PARTICIPANT_CREDENTIAL_COOKIE } from "@/server/session-api/participant-credential";
import { getOwnMergeProposals, consentParticipantMerge } from "@/server/operator-api/participant-merge";
import { jsonResponse } from "@/server/public-api/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    requireIdentityRateLimit(request);
    return jsonResponse(await getOwnMergeProposals((await context.params).token, request.cookies.get(PARTICIPANT_CREDENTIAL_COOKIE)?.value));
  } catch (error) { return identityErrorResponse(error); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    requireParticipantMutationRequest(request);
    requireIdentityRateLimit(request);
    const body = await readIdentityBody(request);
    requireIdentityKeys(body, ["id", "approve"]);
    if (typeof body.id !== "string" || typeof body.approve !== "boolean") throw invalidBody();
    return jsonResponse(await consentParticipantMerge((await context.params).token, request.cookies.get(PARTICIPANT_CREDENTIAL_COOKIE)?.value, body.id, body.approve));
  } catch (error) { return identityErrorResponse(error); }
}
