import { HttpException, HttpStatus } from "@nestjs/common";

import type { RateLimitedError } from "@bms/shared";

/**
 * `F4.17` / ADR 0125 decision 9 — the **one** place a rate-limit refusal is
 * built, so `F4.21`'s RFC 7807 envelope converts a single site.
 */

/** What a refusal needs to describe itself. */
export type RateLimitRefusal = Readonly<{
  /** The bucket that refused: a Stage 2 class or a Stage 1 bucket. */
  bucket: string;
  limit: number;
  windowMs: number;
  resetMs: number;
}>;

export function retryAfterSeconds(resetMs: number): number {
  return Math.max(1, Math.ceil(resetMs / 1000));
}

export function rateLimitedBody(refusal: RateLimitRefusal): RateLimitedError {
  const seconds = retryAfterSeconds(refusal.resetMs);
  return {
    statusCode: 429,
    error: "Too Many Requests",
    code: "rate_limited",
    message: `Too many requests. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
    retryAfterSeconds: seconds,
  };
}

/**
 * `Retry-After`, plus the `RateLimit-Policy` / `RateLimit` pair from
 * `draft-ietf-httpapi-ratelimit-headers`. CORS exposes none of them (the
 * `F3.47` ruling); the SPA reads `retryAfterSeconds` from the body.
 */
export function rateLimitedHeaders(refusal: RateLimitRefusal): Record<string, string> {
  const seconds = retryAfterSeconds(refusal.resetMs);
  const windowSeconds = Math.round(refusal.windowMs / 1000);
  return {
    "Retry-After": String(seconds),
    "RateLimit-Policy": `"${refusal.bucket}";q=${refusal.limit};w=${windowSeconds}`,
    RateLimit: `"${refusal.bucket}";r=0;t=${seconds}`,
  };
}

/** The exception the guard throws; the caller sets `rateLimitedHeaders` on the response first. */
export function rateLimitedException(refusal: RateLimitRefusal): HttpException {
  return new HttpException(rateLimitedBody(refusal), HttpStatus.TOO_MANY_REQUESTS);
}
