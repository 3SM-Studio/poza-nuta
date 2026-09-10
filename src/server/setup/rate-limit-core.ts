type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitScope = "setup-invite" | "setup-signup" | "setup-token";

const RATE_LIMITS: Record<
  RateLimitScope,
  { maxAttempts: number; windowMs: number }
> = {
  "setup-signup": {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1_000,
  },
  "setup-invite": {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1_000,
  },
  "setup-token": {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1_000,
  },
};

const globalForSetupRateLimit = globalThis as typeof globalThis & {
  pozaNutaSetupRateLimit?: Map<string, RateLimitBucket>;
};

const buckets =
  globalForSetupRateLimit.pozaNutaSetupRateLimit ??
  new Map<string, RateLimitBucket>();

globalForSetupRateLimit.pozaNutaSetupRateLimit = buckets;

export function consumeSetupRateLimit(input: {
  scope: RateLimitScope;
  key: string;
  now?: number;
}) {
  const limit = RATE_LIMITS[input.scope];
  const now = input.now ?? Date.now();
  const bucketKey = `${input.scope}:${input.key}`;
  const existing = buckets.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    buckets.set(bucketKey, {
      count: 1,
      resetAt: now + limit.windowMs,
    });

    return { allowed: true as const };
  }

  if (existing.count >= limit.maxAttempts) {
    return {
      allowed: false as const,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1_000),
    };
  }

  existing.count += 1;

  return { allowed: true as const };
}

export function resetSetupRateLimitForTests() {
  buckets.clear();
}
