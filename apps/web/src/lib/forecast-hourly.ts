import type { PointAggregateBucket } from "@bms/shared";

const HOUR_MS = 3_600_000;

/** One whole UTC hour of actuals: its start (ISO) and its mean, `null` when the hour holds no sample. */
export type HourlyMean = { readonly t: string; readonly v: number | null };

/**
 * `E1.4c` (plan R10) — the forecast widget's actual line: the 1-minute buckets of the aggregate
 * read (`bucketFunction=avg&bucketStats=true`) averaged to whole UTC hours, **weighted by each
 * bucket's `sampleCount`**. That is `sum / count` over the hour, which is what the `_1h` rollup the
 * scorer read holds, so the actual line and the forecast describe the same quantity.
 *
 * A bucket's mean is its `average` (the weighted mean `bucketStats` adds), else its `v`. A bucket
 * with no samples, or no mean, adds nothing; an hour with no samples at all is `null`, a gap the
 * chart draws as one. **Given the window (`fromMs`, `toMs`), every UTC hour in it is present**,
 * seeded `null`: the aggregate route does not gap-fill, so an hour the RTU was offline has no bucket
 * at all, and without the seed the line would join straight across the outage (PR 4 code review).
 * Hours are UTC by epoch arithmetic, never by the browser's zone: the forecast's buckets are UTC
 * hours, and a site in India or Nepal has a fractional offset.
 *
 * The first hour of a trailing 24 h window is partial, so it can differ from that hour's `_1h`
 * value (plan §16, "Departures"). Ascending by hour; a malformed `t` is skipped.
 */
/** The most hours a window seeds: the widget reads 24 h; anything wider is a malformed window. */
const MAX_SEEDED_HOURS = 49;

export function hourlyMeans(
  buckets: readonly PointAggregateBucket[],
  fromMs?: number,
  toMs?: number,
): HourlyMean[] {
  const hours = new Map<number, { sum: number; count: number }>();
  if (fromMs !== undefined && toMs !== undefined && Number.isFinite(fromMs) && Number.isFinite(toMs)) {
    const first = Math.floor(fromMs / HOUR_MS) * HOUR_MS;
    const last = Math.floor(toMs / HOUR_MS) * HOUR_MS;
    for (let hour = first; hour <= last && (hour - first) / HOUR_MS < MAX_SEEDED_HOURS; hour += HOUR_MS) {
      hours.set(hour, { sum: 0, count: 0 });
    }
  }
  for (const bucket of buckets) {
    const ms = Date.parse(bucket.t);
    if (!Number.isFinite(ms)) {
      continue;
    }
    const hour = Math.floor(ms / HOUR_MS) * HOUR_MS;
    const acc = hours.get(hour) ?? { sum: 0, count: 0 };
    hours.set(hour, acc);
    const mean = bucket.average ?? bucket.v;
    const count = bucket.sampleCount ?? 0;
    if (mean === null || mean === undefined || count <= 0) {
      continue;
    }
    acc.sum += mean * count;
    acc.count += count;
  }
  return [...hours.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, { sum, count }]) => ({ t: new Date(hour).toISOString(), v: count > 0 ? sum / count : null }));
}
