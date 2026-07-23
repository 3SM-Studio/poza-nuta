import { randomBytes, randomUUID } from "node:crypto";

export const EVENT_PUBLIC_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const EVENT_SESSION_PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const EVENT_SESSION_TOKEN_BYTES = 16;
export const EVENT_SESSION_IDENTITY_ATTEMPTS = 8;

export type EventSessionIdentity = {
  eventPublicId: string;
  publicToken: string;
};

export function generateEventSessionIdentity(): EventSessionIdentity {
  const tokenBytes = randomBytes(EVENT_SESSION_TOKEN_BYTES);

  try {
    return {
      eventPublicId: randomUUID(),
      publicToken: tokenBytes.toString("base64url"),
    };
  } finally {
    tokenBytes.fill(0);
  }
}

export function isEventPublicId(value: string) {
  return EVENT_PUBLIC_ID_PATTERN.test(value);
}

export function isEventSessionPublicToken(value: string) {
  return EVENT_SESSION_PUBLIC_TOKEN_PATTERN.test(value);
}

export async function withEventSessionIdentityRetry<T>(
  operation: (identity: EventSessionIdentity) => Promise<T>,
  isCollision: (error: unknown) => boolean,
  options: {
    attempts?: number;
    generate?: () => EventSessionIdentity;
  } = {},
) {
  const attempts = options.attempts ?? EVENT_SESSION_IDENTITY_ATTEMPTS;
  const generate = options.generate ?? generateEventSessionIdentity;

  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error("Event session identity retry count must be positive.");
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(generate());
    } catch (error) {
      if (!isCollision(error) || attempt === attempts) throw error;
    }
  }

  throw new Error("Event session identity generation exhausted unexpectedly.");
}
