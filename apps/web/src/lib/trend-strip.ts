import type { TrendStripRange } from "@bms/shared";

import { formatInZone, siteZoneOf } from "../components/asset-history/history-format";
import { assetHistoryPath } from "./asset-history-range";
import { formatBucketWidth } from "./widget-value";

/**
 * `F4.301` U4 (ADR 0108 Amendment 2, items 5, 7 and 9) — the trend strip's pure helpers: the
 * sparkline geometry, the click target, the last value and the window line. No segment, no
 * organization and no point code is named here; every one comes from the response.
 */

/** A bucket as the sparkline reads it: only the value matters, `null` is a gap. */
export interface SparklineBucket {
  readonly v: number | null;
}

/**
 * The `points` attribute of each polyline for `buckets` in a `width` × `height` box. A `null`
 * breaks the line; x is the bucket position (first at 0, last at `width`), y is the value scaled
 * between the series min (bottom) and max (top); all-equal values draw at mid height. No value
 * at all draws nothing.
 */
export function sparklinePolylines(
  buckets: readonly SparklineBucket[],
  width: number,
  height: number,
): string[] {
  const values = buckets.map((b) => b.v).filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length === 0) {
    return [];
  }
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  const step = buckets.length > 1 ? width / (buckets.length - 1) : 0;
  const round = (n: number) => Math.round(n * 100) / 100;

  const lines: string[] = [];
  let current: string[] = [];
  buckets.forEach((bucket, i) => {
    const v = bucket.v;
    if (v === null || !Number.isFinite(v)) {
      if (current.length > 0) {
        lines.push(current.join(" "));
        current = [];
      }
      return;
    }
    const x = buckets.length > 1 ? i * step : width / 2;
    const y = span === 0 ? height / 2 : height - ((v - min) / span) * height;
    current.push(`${round(x)},${round(y)}`);
  });
  if (current.length > 0) {
    lines.push(current.join(" "));
  }
  return lines;
}

/** One sparkline's click target: the asset's history page at the strip's range and point. */
export function historyHref(assetId: string, range: TrendStripRange, code: string): string {
  return `${assetHistoryPath(assetId)}?${new URLSearchParams({ range, points: code })}`;
}

/** The newest non-null value of a series; `null` when it has none. */
export function lastValue(buckets: readonly SparklineBucket[]): number | null {
  for (let i = buckets.length - 1; i >= 0; i -= 1) {
    const v = buckets[i].v;
    if (v !== null) {
      return v;
    }
  }
  return null;
}

/**
 * `<from> – <to> · <fold width> buckets · <zone>`: both ends formatted in the site's
 * arithmetic zone, the zone printed as the response reports it (a stored `UTC` prints `UTC`).
 */
export function stripWindowLabel(from: string, to: string, bucketSeconds: number, timeZone: string): string {
  const { zone } = siteZoneOf(timeZone);
  return `${formatInZone(from, zone)} – ${formatInZone(to, zone)} · ${formatBucketWidth(bucketSeconds)} buckets · ${timeZone}`;
}
