/**
 * `F3.1d` review finding (HIGH) — the seed/overlay composition
 * `use-dashboard-telemetry.ts` needs, extracted so it is testable without a socket or a running
 * API. `apps/web/src/hooks/**` is not in the coverage denominator (`vitest.config.ts:46-53` is
 * `lib/**` only), so leaving this inline in the hook would leave the duplicate-sample defect
 * unasserted no matter how carefully it were patched in place.
 *
 * **The bug this closes.** `fetchTelemetryRecent` reruns on every window-focus refetch
 * (`main.tsx` leaves `refetchOnWindowFocus` at the TanStack default, with `staleTime: 0`), and
 * the fresh window it returns already contains whatever readings arrived over the socket while
 * the tab was backgrounded. The live overlay is reset only when the tracked ref set changes, so
 * concatenating the two unconditionally draws the same samples twice — `buildChartOption`
 * neither filters nor deduplicates, so ECharts draws the polyline doubling back on itself.
 */

/** The minimal shape this needs from a reading — `TelemetryReading` satisfies it without a
 * direct dependency, so a fixture here needs no unrelated fields. */
export type TimedSample = { readonly time: string };

/**
 * Combines a REST seed (`fetchTelemetryRecent`'s own newest-first order) with a live socket
 * overlay (oldest-first, receive order) into one oldest-first list — with the overlap a
 * window-focus refetch creates removed.
 *
 * **The rule: drop a live sample once its `time` is not strictly newer than the newest seeded
 * sample's `time`.** The seed already carries it; keeping it too is the duplicate. A live
 * sample strictly newer than the seed's newest point is genuinely new and is kept — this is
 * what lets the overlay extend the chart forward between REST refetches, which is its whole job.
 */
export function mergeSeededAndLiveReadings<T extends TimedSample>(
  seededNewestFirst: readonly T[],
  liveAscending: readonly T[],
): T[] {
  const seededAscending = [...seededNewestFirst].reverse();
  if (liveAscending.length === 0) {
    return seededAscending;
  }

  const newestSeeded = seededAscending[seededAscending.length - 1];
  const newestSeededMs = newestSeeded ? Date.parse(newestSeeded.time) : NaN;
  const freshLive =
    Number.isNaN(newestSeededMs)
      ? liveAscending
      : liveAscending.filter((reading) => {
          const ms = Date.parse(reading.time);
          return Number.isNaN(ms) || ms > newestSeededMs;
        });

  return [...seededAscending, ...freshLive];
}
