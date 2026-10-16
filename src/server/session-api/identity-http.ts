import "server-only";

import type { NextRequest } from "next/server";
import { PublicApiError } from "../public-api/errors";
import { publicApiErrorResponse } from "../public-api/responses";
import { OperatorApiError } from "../operator-api/errors";
import { consumeSessionRateLimit } from "./rate-limit-core";
import { hashParticipantCredential, PARTICIPANT_CREDENTIAL_COOKIE } from "./participant-credential";

export function requireIdentityRateLimit(request: NextRequest) {
  const credential = request.cookies.get(PARTICIPANT_CREDENTIAL_COOKIE)?.value;
  const hash = credential ? hashParticipantCredential(credential) : null;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  for (const key of [`ip:${ip}`, ...(hash ? [`credential:${hash}`] : [])]) {
    if (!consumeSessionRateLimit({ scope: "linking", key }).allowed) {
      throw new PublicApiError(429, "SESSION_RATE_LIMITED", "Too many identity requests.");
    }
  }
}

export async function readIdentityBody(request: Request, maxBytes = 1024): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw invalidBody();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw invalidBody(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalidBody(); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidBody();
  return body as Record<string, unknown>;
}

export function requireIdentityKeys(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).length !== keys.length || keys.some(key => !(key in body))) throw invalidBody();
}
export function invalidBody() { return new PublicApiError(400, "VALIDATION_ERROR", "Invalid identity operation."); }
export function identityErrorResponse(error: unknown) {
  return publicApiErrorResponse(error instanceof OperatorApiError ? new PublicApiError(error.status === 401 ? 403 : error.status, error.code, error.message) : error);
}
