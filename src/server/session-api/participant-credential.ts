import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";

export const PARTICIPANT_CREDENTIAL_COOKIE = "poza_nuta_participant";
export const PARTICIPANT_CREDENTIAL_TTL_MS = 180 * 24 * 60 * 60 * 1_000;

const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateParticipantCredential() {
  return randomBytes(32).toString("base64url");
}

export function isParticipantCredential(value: string | undefined | null): value is string {
  return typeof value === "string" && CREDENTIAL_PATTERN.test(value);
}

export function hashParticipantCredential(value: string) {
  if (!isParticipantCredential(value)) return null;
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function setParticipantCredentialCookie(
  response: NextResponse,
  value: string,
  expiresAt: Date,
) {
  response.cookies.set({
    name: PARTICIPANT_CREDENTIAL_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}
