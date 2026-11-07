import type { TrendStripPointStyle, TrendStripRange, TrendStripWidgetConfig } from "@bms/shared";

import { formatInZone, siteZoneOf } from "../components/asset-history/history-format";
import { assetHistoryPath } from "./asset-history-range";
import type { RoleName } from "./theme";
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

/**
 * `F4.323` PR 3 (ADR 0108 Amendment 8) — the `area` style: each run of
 * {@link sparklinePolylines} closed down to the bottom edge, as a polygon's `points`. A `null`
 * still breaks the run, so a gap shows in the fill as in the line.
 */
export function sparklineAreas(buckets: readonly SparklineBucket[], width: number, height: number): string[] {
  return sparklinePolylines(buckets, width, height).map((line) => {
    const pairs = line.split(" ");
    const xOf = (pair: string) => pair.slice(0, pair.indexOf(","));
    return [`${xOf(pairs[0] ?? "0,0")},${height}`, ...pairs, `${xOf(pairs[pairs.length - 1] ?? "0,0")},${height}`].join(" ");
  });
}

/** One bar of the `bar` style, in the sparkline's own box. */
export interface SparklineBar {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * `F4.323` PR 3 — the `bar` style: one bar per non-`null` bucket, in that bucket's slot (80 % of
 * it, centred), drawn from the zero line toward its value — up for a positive value, down for a
 * negative one. The box spans `min(0, lowest)` to `max(0, highest)`. Every non-`null` bucket is
 * at least 1 px tall, so a zero or a constant series still reads as data, never as a gap.
 */
export function sparklineBars(buckets: readonly SparklineBucket[], width: number, height: number): SparklineBar[] {
  const values = buckets.map((b) => b.v).filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length === 0) return [];
  const base = Math.min(0, ...values);
  const span = Math.max(0, ...values) - base;
  const yOf = (v: number) => (span === 0 ? height : height - ((v - base) / span) * height);
  const zeroY = yOf(0);
  const slot = width / buckets.length;
  const round = (n: number) => Math.round(n * 100) / 100;
  const bars: SparklineBar[] = [];
  buckets.forEach((bucket, i) => {
    const v = bucket.v;
    if (v === null || !Number.isFinite(v)) return;
    const top = Math.min(zeroY, yOf(v));
    const barHeight = Math.max(1, Math.abs(zeroY - yOf(v)));
    const y = Math.min(top, height - barHeight);
    bars.push({ x: round(i * slot + slot * 0.1), y: round(y), width: round(slot * 0.8), height: round(barHeight) });
  });
  return bars;
}

/**
 * `F4.323` PR 3 — which layers each style draws. A keyed table, not string compares, so the
 * style names are stated here once (the `tests/f3.1c-widget-series-mapping.test.ts` scan reads
 * quoted `line`/`bar`/`area` as an ECharts mapping, which this is not).
 */
export const SPARKLINE_LAYERS: Readonly<
  Record<TrendStripPointStyle, { readonly line: boolean; readonly fill: boolean; readonly bars: boolean }>
> = {
  line: { line: true, fill: false, bars: false },
  area: { line: true, fill: true, bars: false },
  bar: { line: false, fill: false, bars: true },
};

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

/**
 * `F4.306` U9 (ADR 0108 Amendment 7, item 4) — the stroke role of one point: the strip's `colors`
 * entry for `<domain>:<code>`, else `accent`. The key is composed here once, from the response's
 * segment domain and point code, so no component spells it.
 */
export function strokeRoleFor(
  colors: TrendStripWidgetConfig["colors"] | undefined,
  domain: string,
  code: string,
): RoleName {
  return colors?.[`${domain}:${code}`] ?? "accent";
}

/** `F4.323` PR 3 — the style a point draws in when the strip names none: today's line. */
export const DEFAULT_POINT_STYLE: TrendStripPointStyle = "line";

/**
 * `F4.323` PR 3 (ADR 0108 Amendment 8) — the draw style of one point: the strip's `styles` entry
 * for `<domain>:<code>`, else `line` (today's look). Keyed here once, as {@link strokeRoleFor} is.
 */
export function pointStyleFor(
  styles: TrendStripWidgetConfig["styles"] | undefined,
  domain: string,
  code: string,
): TrendStripPointStyle {
  return styles?.[`${domain}:${code}`] ?? DEFAULT_POINT_STYLE;
}
