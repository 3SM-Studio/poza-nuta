export const SESSION_CODE_LENGTH = 8;
export const SESSION_CODE_PATTERN = /^[0-9]{8}$/;
export const SESSION_CODE_GENERATION_ATTEMPTS = 8;

export function generateCanonicalSessionCode(
  draw: (max: number) => number = drawSecureRandomInteger,
) {
  return draw(100_000_000).toString().padStart(SESSION_CODE_LENGTH, "0");
}

function drawSecureRandomInteger(max: number) {
  const range = 0x1_0000_0000;
  const rejectionLimit = Math.floor(range / max) * max;
  const value = new Uint32Array(1);

  do {
    globalThis.crypto.getRandomValues(value);
  } while (value[0] >= rejectionLimit);

  return value[0] % max;
}

export function normalizeSessionCode(value: string) {
  return value.replace(/[\s-]+/g, "");
}

export function isCanonicalSessionCode(value: string) {
  return SESSION_CODE_PATTERN.test(value);
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
      if (!isCollision(error) || attempt === attempts) {
        throw error;
      }
    }
  }

  throw new Error("Session code generation exhausted unexpectedly.");
}
