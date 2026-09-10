type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type SessionRateLimitScope = "page" | "api";

const limits: Record<SessionRateLimitScope, { max: number; windowMs: number }> = {
  page: { max: 12, windowMs: 60_000 },
  api: { max: 120, windowMs: 60_000 },
};

const globalRateLimit = globalThis as typeof globalThis & {
  pozaNutaSessionRateLimit?: Map<string, RateLimitBucket>;
};

const buckets =
  globalRateLimit.pozaNutaSessionRateLimit ?? new Map<string, RateLimitBucket>();
globalRateLimit.pozaNutaSessionRateLimit = buckets;

export function consumeSessionRateLimit(input: {
  scope: SessionRateLimitScope;
  key: string;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const limit = limits[input.scope];
  const bucketKey = `${input.scope}:${input.key}`;
  const current = buckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + limit.windowMs });
    return { allowed: true as const, retryAfterSeconds: 0 };
  }

  if (current.count >= limit.max) {
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }

  current.count += 1;
  return { allowed: true as const, retryAfterSeconds: 0 };
}

export function resetSessionRateLimitForTests() {
  buckets.clear();
}
