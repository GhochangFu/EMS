import { z } from "zod";

/**
 * `F4.17` / ADR 0125 decision 9 — the one 429 body the API sends when a
 * request rate limit refuses a request. Nest's default envelope plus a stable
 * `code` and the wait in whole seconds, so the SPA can say how long to wait
 * without reading `Retry-After` across CORS (the `F3.47` ruling). `F4.21`
 * maps `code` to a problem `type` and changes no call site.
 */
export const rateLimitedErrorSchema = z
  .object({
    statusCode: z.literal(429),
    error: z.literal("Too Many Requests"),
    code: z.literal("rate_limited"),
    message: z.string(),
    retryAfterSeconds: z.number().int().min(1),
  })
  .strict();

/**
 * `F4.17` / ADR 0125 decision 4 — the limiter's section of `GET /health`.
 * `store` says where the counters live: `redis` (shared by every API
 * process), `memory` (no `REDIS_URL`, so each process counts alone, a chosen
 * state) or `degraded` (Redis is configured and the last store call failed,
 * so the process fell back to memory). Only `degraded` degrades the verdict.
 *
 * **`RATE_LIMIT_MODE` is deliberately absent.** `/health` is public on the
 * AWS demo, and the mode would tell any caller when limits are not enforced
 * (security review, L2). The mode is in the boot log and in the
 * `bms_rate_limit_decisions_total` outcome labels.
 */
export const rateLimitHealthSchema = z
  .object({
    store: z.enum(["redis", "memory", "degraded"]),
  })
  .strict();

/** The limiter section of `GET /health` (ADR 0125 decision 4). */
export type RateLimitHealth = z.infer<typeof rateLimitHealthSchema>;
/** The 429 body (ADR 0125 decision 9). */
export type RateLimitedError = z.infer<typeof rateLimitedErrorSchema>;
