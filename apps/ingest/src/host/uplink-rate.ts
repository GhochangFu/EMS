/**
 * Per-gateway sample rate limit for the uplink receiver (`E7.2`, security
 * review M2 of PR 3).
 *
 * One token bucket per gateway, in **samples** per second: a token is a
 * sample, the bucket holds at most one second's worth, and it refills
 * continuously. A batch that would overdraw it is refused whole with `429`
 * and a `Retry-After` of the whole seconds it must wait — the edge keeps the
 * batch and retries on its backoff (plan C4), so nothing is lost.
 *
 * The edge's own replay throttle (`EDGE_REPLAY_MAX_SAMPLES_PER_S`, default
 * 500/s, plan C3) sits well under the default here (2000/s), so a well-behaved
 * box never meets this; a stolen token or a runaway box does. Per-source
 * limiting of *unauthenticated* requests is not here: it belongs in front of
 * the receiver, at nginx (PR 4), where the client address is known.
 */

/**
 * The least one batch costs, however few samples it carries (round-two review
 * Low-2): a batch is a request, a decode and a transaction, so a flood of
 * one-sample batches must not cost a tenth of a full one.
 */
export const MIN_BATCH_CHARGE = 50;

export type SampleRateLimiter = {
  /**
   * The cheap pre-check before a body is read: `0` when the bucket holds at
   * least `MIN_BATCH_CHARGE`, otherwise the whole seconds (at least 1) until it
   * would. Takes nothing.
   */
  wait(gatewayId: string): number;
  /**
   * Takes `max(samples, MIN_BATCH_CHARGE)` tokens from the gateway's bucket. Returns `0` when the
   * batch is admitted, otherwise the whole seconds (at least 1) after which it
   * would be, and takes nothing.
   */
  take(gatewayId: string, samples: number): number;
};

/** Builds the limiter. `nowMs` is injected so the spec needs no real time. */
export function createSampleRateLimiter(samplesPerSecond: number, nowMs: () => number): SampleRateLimiter {
  const buckets = new Map<string, { tokens: number; atMs: number }>();
  const refilled = (gatewayId: string): { tokens: number; atMs: number } => {
    const now = nowMs();
    const bucket = buckets.get(gatewayId) ?? { tokens: samplesPerSecond, atMs: now };
    const elapsedS = Math.max(0, now - bucket.atMs) / 1000;
    bucket.tokens = Math.min(samplesPerSecond, bucket.tokens + elapsedS * samplesPerSecond);
    bucket.atMs = now;
    buckets.set(gatewayId, bucket);
    return bucket;
  };
  const secondsUntil = (tokens: number, needed: number): number =>
    Math.max(1, Math.ceil((needed - tokens) / samplesPerSecond));
  return {
    wait(gatewayId) {
      const bucket = refilled(gatewayId);
      return bucket.tokens >= MIN_BATCH_CHARGE ? 0 : secondsUntil(bucket.tokens, MIN_BATCH_CHARGE);
    },
    take(gatewayId, samples) {
      const charge = Math.max(samples, MIN_BATCH_CHARGE);
      const bucket = refilled(gatewayId);
      if (bucket.tokens >= charge) {
        bucket.tokens -= charge;
        return 0;
      }
      return secondsUntil(bucket.tokens, charge);
    },
  };
}
