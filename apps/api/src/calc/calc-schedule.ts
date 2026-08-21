/**
 * Truncates `nowMs` to the start of its `intervalSeconds` bucket, on
 * **absolute epoch boundaries** — never local-time ones. `Math.floor` on the
 * raw millisecond count is timezone-independent by construction: a half-hour
 * `TZ` offset (e.g. `Asia/Kolkata`) cannot shift the result, because no
 * `Date` component (hours/minutes in local time) is ever read. This is
 * ADR 0037 decision 8's idempotency claim — two ticks inside the same bucket
 * must produce the identical output `time`, so a recompute is a database
 * no-op via `point_values`'s `(time, assetId, pointKey)` key.
 */
export function bucketTimeMs(nowMs: number, intervalSeconds: number): number {
  const intervalMs = intervalSeconds * 1000;
  return Math.floor(nowMs / intervalMs) * intervalMs;
}

/** Whether a scheduled formula's own interval has elapsed. `lastRunMs: null`
 * means "never run" and is always due. */
export function isDue(args: { intervalSeconds: number; lastRunMs: number | null; nowMs: number }): boolean {
  if (args.lastRunMs === null) {
    return true;
  }
  return args.nowMs - args.lastRunMs >= args.intervalSeconds * 1000;
}
