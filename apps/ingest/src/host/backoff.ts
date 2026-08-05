/**
 * Reconnect backoff (ADR 0016 §5).
 *
 * The numbers are stated in the ADR precisely "so five agents do not invent
 * five policies". The host implements all of it; adapters implement none of it.
 */

export type BackoffPolicy = {
  readonly baseMs: number;
  readonly factor: number;
  readonly capMs: number;
  /** Fractional band, e.g. `0.2` for ±20%. */
  readonly jitter: number;
};

/** The ADR 0016 §5 table, verbatim. */
export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 1_000,
  factor: 2,
  capMs: 60_000,
  jitter: 0.2,
};

/**
 * Delay before retry number `attempt` (0-based: `0` is the first retry).
 *
 * Exponential from `baseMs`, capped at `capMs`, then spread ±`jitter` at
 * random within that band. Jitter is what stops a broker outage turning every
 * endpoint into a synchronised thundering herd when it recovers.
 *
 * **The cap is a hard ceiling.** Jitter is applied after the exponential is
 * capped, so the upper bound is clamped back to `capMs` rather than allowed to
 * reach `capMs × 1.2`. A delay is therefore never longer than the ADR's stated
 * 60 s, at the cost of a slight downward bias once the cap is reached — which
 * is the right trade: a supervisor that waits *longer* than its documented
 * ceiling is the surprising failure.
 *
 * `random` is injected rather than `Math.random` so the spread is testable.
 */
export function backoffDelayMs(
  attempt: number,
  random: () => number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
): number {
  const exponential = policy.baseMs * policy.factor ** Math.max(0, attempt);
  const capped = Math.min(policy.capMs, exponential);
  const band = capped * policy.jitter;
  const jittered = capped - band + random() * 2 * band;
  return Math.round(Math.min(policy.capMs, Math.max(0, jittered)));
}
