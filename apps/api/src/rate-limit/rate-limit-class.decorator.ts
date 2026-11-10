import { SetMetadata } from "@nestjs/common";

import type { RateLimitClass } from "./rate-limit-config";

/**
 * `F4.17` / ADR 0125 decision 5 — puts a route (or a whole controller) in a
 * Stage 2 class other than its method's default. `heavy` is the only class a
 * route is expected to opt into; PR 2 adds a static invariant listing the
 * routes that must carry it.
 */
export const RATE_LIMIT_CLASS_METADATA = "bms:rate-limit-class";

export const RateLimitClassOf = (rateLimitClass: RateLimitClass): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_CLASS_METADATA, rateLimitClass);

/** The class a request falls into: the explicit one, else `GET`/`HEAD`/`OPTIONS` → `read`, anything else → `write`. */
export function rateLimitClassFor(
  method: string | undefined,
  explicit: RateLimitClass | undefined,
): RateLimitClass {
  if (explicit) {
    return explicit;
  }
  const upper = (method ?? "GET").toUpperCase();
  return upper === "GET" || upper === "HEAD" || upper === "OPTIONS" ? "read" : "write";
}
