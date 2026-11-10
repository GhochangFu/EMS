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

export type SampleRateLimiter = {
  /**
   * Takes `samples` tokens from the gateway's bucket. Returns `0` when the
   * batch is admitted, otherwise the whole seconds (at least 1) after which it
   * would be, and takes nothing.
   */
  take(gatewayId: string, samples: number): number;
};

/** Builds the limiter. `nowMs` is injected so the spec needs no real time. */
export function createSampleRateLimiter(samplesPerSecond: number, nowMs: () => number): SampleRateLimiter {
  const buckets = new Map<string, { tokens: number; atMs: number }>();
  return {
    take(gatewayId, samples) {
      const now = nowMs();
      const bucket = buckets.get(gatewayId) ?? { tokens: samplesPerSecond, atMs: now };
      const elapsedS = Math.max(0, now - bucket.atMs) / 1000;
      bucket.tokens = Math.min(samplesPerSecond, bucket.tokens + elapsedS * samplesPerSecond);
      bucket.atMs = now;
      buckets.set(gatewayId, bucket);
      if (bucket.tokens >= samples) {
        bucket.tokens -= samples;
        return 0;
      }
      return Math.max(1, Math.ceil((samples - bucket.tokens) / samplesPerSecond));
    },
  };
}
