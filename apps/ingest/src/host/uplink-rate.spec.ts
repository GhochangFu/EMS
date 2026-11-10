import { assert } from "./normaliser.spec.js";
import { createSampleRateLimiter } from "./uplink-rate.js";

/**
 * `E7.2` security review M2 — the per-gateway sample bucket. Assertions live
 * here; `uplink-rate.test.ts` is the vitest entry point (ADR 0014).
 */

/** A full second's worth is admitted at once; the next sample waits. */
export function aFullBucketAdmitsOneSecondThenRefuses(): void {
  let now = 0;
  const limiter = createSampleRateLimiter(1000, () => now);
  assert(limiter.take("g", 500) === 0 && limiter.take("g", 500) === 0, "1000 samples fit in a full bucket");
  const wait = limiter.take("g", 500);
  assert(wait === 1, `an empty bucket must refuse with Retry-After 1, got ${wait}`);
  now = 499;
  assert(limiter.take("g", 500) !== 0, "499 ms refills 499 samples, not 500");
  now = 500;
  assert(limiter.take("g", 500) === 0, "500 ms refills 500 samples");
}

/** A refused batch takes nothing from the bucket. */
export function aRefusalTakesNothing(): void {
  const now = 0;
  const limiter = createSampleRateLimiter(1000, () => now);
  limiter.take("g", 700);
  assert(limiter.take("g", 500) > 0, "300 left cannot admit 500");
  assert(limiter.take("g", 300) === 0, "the refusal took nothing, so 300 still fit");
}

/** Gateways have their own buckets. */
export function bucketsArePerGateway(): void {
  const limiter = createSampleRateLimiter(1000, () => 0);
  limiter.take("a", 1000);
  assert(limiter.take("a", 1) > 0, "a is empty");
  assert(limiter.take("b", 1000) === 0, "b is not held up by a");
}

/** The bucket never holds more than one second, however long a gateway was idle. */
export function theBucketCapsAtOneSecond(): void {
  let now = 0;
  const limiter = createSampleRateLimiter(1000, () => now);
  limiter.take("g", 1);
  now = 3_600_000;
  assert(limiter.take("g", 1000) === 0, "a full second after an idle hour");
  assert(limiter.take("g", 1) > 0, "but not more than one second");
}
