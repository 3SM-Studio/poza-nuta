type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type SessionRateLimitScope = "page" | "api" | "presence" | "linking";

const limits: Record<SessionRateLimitScope, { max: number; windowMs: number }> = {
  page: { max: 12, windowMs: 60_000 },
  api: { max: 120, windowMs: 60_000 },
  presence: { max: 240, windowMs: 60_000 },
  linking: { max: 60, windowMs: 60_000 },
};

const globalRateLimit = globalThis as typeof globalThis & {
  pozaNutaSessionRateLimit?: Map<string, RateLimitBucket>;
  pozaNutaPresenceRateLimit?: Map<string, RateLimitBucket>;
};

// Defense-in-depth only. Production enumeration protection is provided by a
// Vercel WAF rate-limit rule in front of every public code-resolution route.
const buckets =
  globalRateLimit.pozaNutaSessionRateLimit ?? new Map<string, RateLimitBucket>();
globalRateLimit.pozaNutaSessionRateLimit = buckets;
const presenceBuckets = globalRateLimit.pozaNutaPresenceRateLimit ?? new Map<string, RateLimitBucket>();
globalRateLimit.pozaNutaPresenceRateLimit = presenceBuckets;
let nextPresenceCleanupAt = 0;

export function consumeSessionRateLimit(input: {
  scope: SessionRateLimitScope;
  key: string;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const bounded = input.scope === "presence" || input.scope === "linking";
  const store = bounded ? presenceBuckets : buckets;
  if (bounded && now >= nextPresenceCleanupAt) {
    for (const [key, bucket] of presenceBuckets) if (bucket.resetAt <= now) presenceBuckets.delete(key);
    nextPresenceCleanupAt = now + 60_000;
  }
  const limit = limits[input.scope];
  const bucketKey = `${input.scope}:${input.key}`;
  const current = store.get(bucketKey);

  if (!current || current.resetAt <= now) {
    if (bounded && !current && store.size >= 10_000) return { allowed: false as const, retryAfterSeconds: 60 };
    store.set(bucketKey, { count: 1, resetAt: now + limit.windowMs });
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
  presenceBuckets.clear();
  nextPresenceCleanupAt = 0;
}
