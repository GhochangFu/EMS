import {
  AGGREGATE_REFETCH_MS,
  refsToRefetch,
  shouldRefetchAggregates,
} from "./dashboard-aggregate-refresh";
import { FRESH_MS, STALE_TICK_MS } from "./schematic-telemetry";

/**
 * `F3.35` Stage A — the aggregate re-read throttle. Assertions live here;
 * `dashboard-aggregate-refresh.test.ts` is the vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NOW = 1_756_000_000_000;

/**
 * **The two bounds, asserted against the imported constants rather than
 * against literals.**
 *
 * Writing `15_000 < 25_000` here would agree with itself forever while
 * disagreeing with the constants it is about. Reading `FRESH_MS` and
 * `STALE_TICK_MS` means that shortening the freshness window — which `F4.37`
 * considered and declined — fails here, where the reason is written down.
 */
export function assertTheThrottleSitsBetweenItsTwoBounds(): void {
  assert(
    AGGREGATE_REFETCH_MS < FRESH_MS,
    `the aggregate refetch floor (${AGGREGATE_REFETCH_MS}ms) must stay under FRESH_MS ` +
      `(${FRESH_MS}ms), or a bucketed chart goes stale on refetch latency alone and shows ` +
      "Offline while live data flows",
  );
  assert(
    AGGREGATE_REFETCH_MS > STALE_TICK_MS,
    `the aggregate refetch floor (${AGGREGATE_REFETCH_MS}ms) must stay above STALE_TICK_MS ` +
      `(${STALE_TICK_MS}ms), or every staleness tick fires a query of up to 2,880 rows`,
  );
}

/** The first sample after a page opens re-reads immediately; there is nothing to throttle against. */
export function assertTheFirstSampleAlwaysRefetches(): void {
  assert(
    shouldRefetchAggregates(null, NOW),
    "the first live sample must re-read — a page that has never refetched has no floor to respect",
  );
}

/**
 * The floor itself, on both sides and exactly on it.
 *
 * The boundary is inclusive: a sample arriving at exactly the floor re-reads.
 * The alternative would make a perfectly periodic emitter — which `apps/sim` is
 * — refetch at half the intended rate, because every sample would land one
 * millisecond short.
 */
export function assertTheFloorIsInclusiveAndHolds(): void {
  assert(
    !shouldRefetchAggregates(NOW, NOW),
    "a sample in the same instant as the last re-read must not re-read again",
  );
  assert(
    !shouldRefetchAggregates(NOW - (AGGREGATE_REFETCH_MS - 1), NOW),
    "one millisecond inside the floor must not re-read",
  );
  assert(
    shouldRefetchAggregates(NOW - AGGREGATE_REFETCH_MS, NOW),
    "exactly at the floor must re-read — a periodic emitter would otherwise halve its rate",
  );
  assert(
    shouldRefetchAggregates(NOW - (AGGREGATE_REFETCH_MS + 1), NOW),
    "past the floor must re-read",
  );
}

/**
 * **The throttle is per ref, and this is the assertion that says why**
 * (code review).
 *
 * One page-wide clock looked equivalent to this and was not. The socket handler
 * invalidates only the refs in the payload it is holding, so with a shared clock
 * the first payload of a round resets the floor and every later payload is
 * discarded with nothing queueing it. Several payloads per round is the normal
 * case here — `notify-chunk.ts` splits a write batch at 7,000 bytes, `ingest`
 * and `sim` chunk independently, and five RTUs publish on their own cadences.
 *
 * Arrival order is stable, so the losing ref loses every round: its tile would
 * show its page-load number for the life of the page while its sensor reported
 * normally.
 */
export function assertOneRefsRefetchDoesNotSuppressAnother(): void {
  const clock = new Map<string, number>();

  const first = refsToRefetch(["a"], clock, NOW);
  assert(first.length === 1 && first[0] === "a", "the first payload re-reads its own ref");

  // The second payload of the same round, milliseconds later. Under a shared
  // clock this returned nothing and `b` was never re-read.
  const second = refsToRefetch(["b"], clock, NOW + 5);
  assert(
    second.length === 1 && second[0] === "b",
    "a ref that has not been re-read must not be suppressed by another ref that just was",
  );

  // `a` is still inside its own floor, so it does not re-read again.
  assert(
    refsToRefetch(["a"], clock, NOW + 10).length === 0,
    "a ref inside its own floor must not re-read again",
  );

  // Past the floor, it does.
  assert(
    refsToRefetch(["a"], clock, NOW + AGGREGATE_REFETCH_MS).length === 1,
    "past its own floor a ref re-reads",
  );
}

/** A payload naming the same ref twice is one re-read, not two. */
export function assertARepeatedRefInOnePayloadIsOneRefetch(): void {
  const clock = new Map<string, number>();
  const due = refsToRefetch(["a", "a", "b"], clock, NOW);
  assert(
    due.length === 2 && due.includes("a") && due.includes("b"),
    `a duplicated ref must collapse to one re-read, got ${JSON.stringify(due)}`,
  );
}
