import { NextResponse, type NextRequest } from "next/server";
import { requireParticipantMutationRequest } from "@/server/session-api/http";
import { invalidBody, identityErrorResponse, readIdentityBody, requireIdentityKeys, requireIdentityRateLimit } from "@/server/session-api/identity-http";
import { approveDeviceLink, cancelDeviceLink, finishDeviceLink, getDeviceLinkState, issueDeviceLink, LINK_CHALLENGE_COOKIE, prepareDeviceLink } from "@/server/session-api/linking";
import { PARTICIPANT_CREDENTIAL_COOKIE, setParticipantCredentialCookie } from "@/server/session-api/participant-credential";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
const response = (body: unknown) => NextResponse.json(body, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

export async function GET(request: NextRequest, context: Context) {
  try {
    requireIdentityRateLimit(request);
    const { token } = await context.params;
    return response(await getDeviceLinkState(token, request.cookies.get(PARTICIPANT_CREDENTIAL_COOKIE)?.value, request.cookies.get(LINK_CHALLENGE_COOKIE)?.value));
  } catch (error) { return identityErrorResponse(error); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    requireParticipantMutationRequest(request);
    requireIdentityRateLimit(request);
    const body = await readIdentityBody(request);
    const { token } = await context.params;
    const credential = request.cookies.get(PARTICIPANT_CREDENTIAL_COOKIE)?.value;
    const challenge = request.cookies.get(LINK_CHALLENGE_COOKIE)?.value;
    switch (body.action) {
      case "issue":
        requireIdentityKeys(body, ["action"]);
        return response(await issueDeviceLink(token, credential));
      case "prepare": {
        requireIdentityKeys(body, ["action", "token"]);
        if (typeof body.token !== "string") throw invalidBody();
        const result = await prepareDeviceLink(token, credential, body.token, challenge);
        const reply = response({ link: result.link });
        // A bound retry may restore the same credential after a lost response.
        reply.cookies.set({ name: LINK_CHALLENGE_COOKIE, value: result.challenge, httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/api/s", expires: new Date(result.link.expiresAt.getTime() + 600_000) });
        return reply;
      }
      case "approve":
        requireIdentityKeys(body, ["action", "id", "code"]);
        if (typeof body.id !== "string" || typeof body.code !== "string") throw invalidBody();
        return response(await approveDeviceLink(token, credential, body.id, body.code));
      case "finish": {
        requireIdentityKeys(body, ["action", "id"]);
        if (typeof body.id !== "string") throw invalidBody();
        const result = await finishDeviceLink(token, credential, body.id, challenge);
        const reply = response({ linked: true });
        setParticipantCredentialCookie(reply, result.credential, result.credentialExpiresAt);
        // Retain the short HttpOnly receipt until its expiry. A connection can
        // fail after headers (credential cookie) but before the success body;
        // the same receiver can then retry without minting another credential.
        return reply;
      }
      case "cancel":
        requireIdentityKeys(body, ["action", "id"]);
        if (typeof body.id !== "string") throw invalidBody();
        return response(await cancelDeviceLink(token, credential, body.id));
      default: throw invalidBody();
    }
  } catch (error) { return identityErrorResponse(error); }
}
