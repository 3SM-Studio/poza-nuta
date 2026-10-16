import type { NextRequest } from "next/server";
import { isParticipantPresenceInput } from "@/lib/participant-presence";
import { requireParticipantMutationRequest } from "@/server/session-api/http";
import { PARTICIPANT_CREDENTIAL_COOKIE, hashParticipantCredential } from "@/server/session-api/participant-credential";
import { mutateParticipantPresence } from "@/server/session-api/presence";
import { consumeSessionRateLimit } from "@/server/session-api/rate-limit-core";
import { PublicApiError } from "@/server/public-api/errors";
import { invalidJsonResponse, jsonResponse, publicApiErrorResponse } from "@/server/public-api/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    requireParticipantMutationRequest(request);
    const credential = request.cookies.get(PARTICIPANT_CREDENTIAL_COOKIE)?.value;
    const hash = credential ? hashParticipantCredential(credential) : null;
    const key = hash ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!consumeSessionRateLimit({ scope: "presence", key }).allowed) {
      throw new PublicApiError(429, "SESSION_RATE_LIMITED", "Too many presence requests.");
    }
    // All accepted bodies are tiny, including application/json sendBeacon blobs.
    const raw = await readSmallBody(request);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return invalidJsonResponse(); }
    if (!isParticipantPresenceInput(body)) throw new PublicApiError(400, "VALIDATION_ERROR", "Invalid connection.");
    const { token } = await context.params;
    return jsonResponse(await mutateParticipantPresence(token, credential, body));
  } catch (error) { return publicApiErrorResponse(error); }
}

async function readSmallBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256) {
        await reader.cancel();
        throw new PublicApiError(400, "VALIDATION_ERROR", "Invalid connection.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
