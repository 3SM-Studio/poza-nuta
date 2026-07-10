import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_INVITE_COOKIE_NAME = "poza_nuta_invite";
export const AUTH_INVITE_COOKIE_MAX_AGE_SECONDS = 10 * 60;
export const AUTH_INVITE_COOKIE_PATH = "/auth";

const MIN_SECRET_BYTES = 32;

type AuthInviteCookiePayload = {
  tokenHash: string;
  type: "invite";
  expiresAt: number;
};

export type AuthInviteCookieReadResult =
  | {
      success: true;
      tokenHash: string;
    }
  | {
      success: false;
    };

export function getAuthInviteCookieSecret(
  env: NodeJS.ProcessEnv = process.env,
) {
  const secret = env.AUTH_INVITE_COOKIE_SECRET?.trim();

  if (!secret || Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    return null;
  }

  return Buffer.from(secret, "utf8");
}

export function createAuthInviteCookieValue(input: {
  tokenHash: string;
  secret: Buffer;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const payload: AuthInviteCookiePayload = {
    tokenHash: input.tokenHash,
    type: "invite",
    expiresAt: now.getTime() + AUTH_INVITE_COOKIE_MAX_AGE_SECONDS * 1000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = sign(encodedPayload, input.secret);

  return `${encodedPayload}.${signature}`;
}

export function readAuthInviteCookieValue(input: {
  value: string | undefined;
  secret: Buffer;
  now?: Date;
}): AuthInviteCookieReadResult {
  if (!input.value) {
    return { success: false };
  }

  const [encodedPayload, signature, extra] = input.value.split(".");

  if (!encodedPayload || !signature || extra !== undefined) {
    return { success: false };
  }

  if (!isValidSignature(encodedPayload, signature, input.secret)) {
    return { success: false };
  }

  let payload: AuthInviteCookiePayload;

  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as AuthInviteCookiePayload;
  } catch {
    return { success: false };
  }

  if (
    payload.type !== "invite" ||
    typeof payload.tokenHash !== "string" ||
    payload.tokenHash.length === 0 ||
    typeof payload.expiresAt !== "number" ||
    payload.expiresAt <= (input.now ?? new Date()).getTime()
  ) {
    return { success: false };
  }

  return {
    success: true,
    tokenHash: payload.tokenHash,
  };
}

function sign(encodedPayload: string, secret: Buffer) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function isValidSignature(
  encodedPayload: string,
  signature: string,
  secret: Buffer,
) {
  const expectedSignature = sign(encodedPayload, secret);
  const actual = Buffer.from(signature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
