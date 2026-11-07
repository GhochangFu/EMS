import { HEATMAP_MAX_WINDOW_MINUTES, HEATMAP_MIN_WINDOW_MINUTES } from "@bms/shared";

import { granularityFor } from "./point-aggregate-window";

/**
 * `F4.323` PR 2 (ADR 0047 Amendment 7 item 5) — every window a heatmap may store is read in
 * hourly buckets, and the windows just outside are not, so moving a rung of the ladder or the
 * shared bounds without the other fails here. Assertions live here; `heatmap-window.test.ts` is
 * the Vitest entry point (ADR 0014).
 */
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function theHeatmapWindowIsTheHourlyRung(): void {
  assert(granularityFor(HEATMAP_MIN_WINDOW_MINUTES) === "1h", "7 days reads hourly buckets");
  assert(granularityFor(HEATMAP_MAX_WINDOW_MINUTES) === "1h", "30 days reads hourly buckets");
  assert(granularityFor(HEATMAP_MAX_WINDOW_MINUTES + 1) === "1d", "past 30 days the read is daily");
}
