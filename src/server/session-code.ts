import "server-only";

import { randomInt } from "node:crypto";

import { SESSION_CODE_LENGTH } from "../lib/session-code.ts";

export const SESSION_CODE_SPACE_SIZE = 1_000_000;
export const SESSION_CODE_GENERATION_ATTEMPTS = 8;

export class SessionCodeGenerationExhaustedError extends Error {
  constructor() {
    super("A unique session code could not be generated.");
    this.name = "SessionCodeGenerationExhaustedError";
  }
}

export function generateCanonicalSessionCode(
  draw: (min: number, max: number) => number = randomInt,
) {
  const value = draw(0, SESSION_CODE_SPACE_SIZE);

  if (!Number.isSafeInteger(value) || value < 0 || value >= SESSION_CODE_SPACE_SIZE) {
    throw new RangeError("Session code random value is outside the canonical range.");
  }

  return value.toString().padStart(SESSION_CODE_LENGTH, "0");
}

export async function withSessionCodeCollisionRetry<T>(
  operation: (code: string) => Promise<T>,
  isCollision: (error: unknown) => boolean,
  options: {
    attempts?: number;
    generate?: () => string;
  } = {},
) {
  const attempts = options.attempts ?? SESSION_CODE_GENERATION_ATTEMPTS;
  const generate = options.generate ?? generateCanonicalSessionCode;

  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error("Session code retry count must be a positive integer.");
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(generate());
    } catch (error) {
      if (!isCollision(error)) throw error;
      if (attempt === attempts) {
        throw new SessionCodeGenerationExhaustedError();
      }
    }
  }

  throw new SessionCodeGenerationExhaustedError();
}
