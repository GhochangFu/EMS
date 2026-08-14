/**
 * Reconnect backoff for the telemetry NOTIFY listener (`F4.34`).
 *
 * **This is a second implementation of ADR 0016 §5's policy, and it is a
 * deliberate copy rather than an oversight.** The first lives in
 * `apps/ingest/src/host/backoff.ts`, whose header records that the numbers are
 * stated in the ADR "so five agents do not invent five policies". So the table
 * below is that one transcribed, not a new policy — the whole point of copying
 * it is to avoid becoming the second policy it warns about.
 *
 * **Why it is not imported from there, or lifted into `@bms/shared`:**
 * `@bms/shared` compiles to **CommonJS** (`packages/shared/tsconfig.build.json`
 * sets `"module": "CommonJS"`) while `apps/ingest` emits **ESM** (`"type":
 * "module"`). Every `@bms/shared` import in `apps/ingest` today is `import
 * type`, which the compiler erases — so that ESM→CJS boundary has **never been
 * crossed at run time** by the ingest container. Moving a *value* into shared
 * would make a just-shipped app cross it for the first time in order to fix a
 * defect that lives in `apps/api`. Unifying the two is cheap once the module
 * systems agree, and is recorded as its own backlog row rather than smuggled
 * into this fix.
 *
 * The duplication is therefore load-bearing information: if you change the
 * numbers here, change them in `apps/ingest/src/host/backoff.ts` too, and say
 * so in the ADR.
 */

export type BackoffPolicy = {
  readonly baseMs: number;
  readonly factor: number;
  readonly capMs: number;
  /** Fractional band, e.g. `0.2` for ±20%. */
  readonly jitter: number;
};

/**
 * The ADR 0016 §5 table, verbatim.
 *
 * The 60 s cap is kept rather than shortened for a user-facing listener. From
 * `baseMs` the sequence is 1·2·4·8·16·32·60 s, so the cap is only reached after
 * roughly two minutes of continuous failure, and a recovery is then noticed
 * within 60 s at worst. Detection does not depend on this: the gauge goes to 0
 * on the first loss, so alerting is immediate regardless of retry pace.
 */
export const DEFAULT_LISTENER_BACKOFF: BackoffPolicy = {
  baseMs: 1_000,
  factor: 2,
  capMs: 60_000,
  jitter: 0.2,
};

/**
 * Delay before retry number `attempt` (0-based: `0` is the first retry).
 *
 * Exponential from `baseMs`, capped at `capMs`, then spread ±`jitter` at random
 * within that band. Jitter matters here for the same reason it does in ingest:
 * an API restarted in parallel across replicas would otherwise reconnect in
 * lockstep and hit the database together.
 *
 * **The cap is a hard ceiling** — jitter is applied after the exponential is
 * capped and clamped back to `capMs`, so a delay is never longer than the
 * documented 60 s.
 *
 * `random` is injected rather than `Math.random` so the spread is testable.
 */
export function listenerBackoffMs(
  attempt: number,
  random: () => number,
  policy: BackoffPolicy = DEFAULT_LISTENER_BACKOFF,
): number {
  const exponential = policy.baseMs * policy.factor ** Math.max(0, attempt);
  const capped = Math.min(policy.capMs, exponential);
  const band = capped * policy.jitter;
  const jittered = capped - band + random() * 2 * band;
  return Math.round(Math.min(policy.capMs, Math.max(0, jittered)));
}
