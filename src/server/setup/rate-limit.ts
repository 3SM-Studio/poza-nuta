import "server-only";

export {
  consumeSetupRateLimit,
  resetSetupRateLimitForTests,
  type RateLimitScope,
} from "./rate-limit-core.ts";
