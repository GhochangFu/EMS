import type { LivenessResponse, RateLimitHealth } from "@bms/shared";

/**
 * `F4.17` / ADR 0125 decision 4 — adds the limiter section to the liveness
 * body. `degraded` (Redis configured, last call fell back to memory) degrades
 * the verdict and still answers 200, the rule every other section follows;
 * `memory` (no `REDIS_URL`) is a chosen state and leaves it alone. No section
 * (`undefined`, the worker) leaves the body untouched.
 */
export function withRateLimitVerdict(
  body: LivenessResponse,
  rateLimit: RateLimitHealth | undefined,
): LivenessResponse {
  if (!rateLimit) {
    return body;
  }
  return {
    ...body,
    status: rateLimit.store === "degraded" ? "degraded" : body.status,
    rateLimit,
  };
}
