import { FRESH_MS, STALE_TICK_MS } from "./schematic-telemetry";

/**
 * `F3.35` Stage A — how often a live sample may re-read a widget's aggregate.
 *
 * **A bucketed series is never extended client-side. It is re-read.** Three
 * reasons, in the order that decides it:
 *
 * 1. **TimescaleDB already serves the newest partial bucket exactly.** ADR 0023
 *    set `materialized_only = false` on all four rollup relations, which ADR
 *    0048 restates as the views being *"exact at their right edge"*. So a
 *    refetch is not an approximation of client-side extension — it is the
 *    correct value, computed by the engine. Extending would be re-deriving
 *    something the database already gets right.
 * 2. Recomputing a bucket's mean in the browser needs `sample_count`, which the
 *    `{ t, v }` bucket shape deliberately does not carry. Adding it back would
 *    put the ADR 0023 weighted division in a place no server test looks at.
 * 3. The raw path already needed `mergeSeededAndLiveReadings` because a
 *    window-focus refetch double-counted the live overlay. A bucketed path that
 *    both extended and refetched would need that merge again, against a
 *    different key shape, for no gain.
 */

/**
 * The floor between two aggregate re-reads driven by live samples.
 *
 * **Not the bucket period, and that distinction is the whole ruling.** The
 * newest bucket changes on *every* sample, all period long — so "at most once
 * per bucket period" would freeze a `1d` chart's live edge for a working day,
 * which is worse than what shipped before this feature. The bucket period
 * governs how often a *new* bucket appears, not how often the current one
 * changes, and the current one is what an operator watches.
 *
 * The number is derived rather than measured:
 *
 * - **Below `FRESH_MS`** (25,000), so a bucketed chart cannot cross its own
 *   staleness threshold on refetch latency alone.
 * - **Above `STALE_TICK_MS`** (5,000). That constant drives a re-render for
 *   staleness re-evaluation; reusing it would fire a query of up to 2,880 rows
 *   three times per staleness tick. It is deliberately not reused, so nobody
 *   reads this number as having inherited that one's measurement.
 *
 * `dashboard-aggregate-refresh.spec.ts` asserts the two inequalities against the
 * imported constants, so moving either bound fails there rather than here.
 */
export const AGGREGATE_REFETCH_MS = 15_000;

/**
 * Whether a live sample may trigger an aggregate re-read now.
 *
 * `lastAtMs` is `null` before the first one. Both times are **arguments** — this
 * reads no clock, which `tests/repo-invariants.test.ts` requires of a pure
 * builder and which lets the spec pin both sides.
 */
export function shouldRefetchAggregates(lastAtMs: number | null, nowMs: number): boolean {
  if (lastAtMs === null) {
    return true;
  }
  return nowMs - lastAtMs >= AGGREGATE_REFETCH_MS;
}

/** Re-exported so a caller need not import two modules to state the relationship. */
export const AGGREGATE_REFETCH_BOUNDS = { floor: STALE_TICK_MS, ceiling: FRESH_MS } as const;
