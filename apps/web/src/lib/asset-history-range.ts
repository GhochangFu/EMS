import { MAX_WIDGET_POINTS, pointAggregateFunctionSchema } from "@bms/shared";
import type { PointAggregateBucket, PointAggregateFunction } from "@bms/shared";

import { instantToZoneInput, zoneInputToInstant } from "./energy-view-filter";

/**
 * `F4.297` U4 (ADR 0108) — the asset history page's state, held in the URL so `F4.303` can
 * reuse it: `range=24h` or `from=&to=`, `compare=1`, `points=kw,pf`, `fn=avg`.
 */

export const HISTORY_PRESETS = [
  { key: "15m", minutes: 15 },
  { key: "24h", minutes: 1440 },
  { key: "7d", minutes: 10080 },
  { key: "30d", minutes: 43200 },
  { key: "1y", minutes: 525600 },
] as const;

export type HistoryPresetKey = (typeof HISTORY_PRESETS)[number]["key"];

/**
 * The history page's path for one asset, `/asset-history/:assetId` (owner ruling 2026-11-01:
 * `/assets/` is nginx's static prefix). `F4.301`'s trend strip links through it, so the path is
 * spelled once for the strip.
 */
export function assetHistoryPath(assetId: string): string {
  return `/asset-history/${encodeURIComponent(assetId)}`;
}

/** The point cap is the widget's; imported so the two never drift. */
export const MAX_HISTORY_POINTS = MAX_WIDGET_POINTS;

const DEFAULT_PRESET: HistoryPresetKey = "24h";
const DEFAULT_FN: PointAggregateFunction = "avg";

export interface HistoryRange {
  /** A preset key, or `custom` (then `from` and `to` are both set). */
  readonly range: HistoryPresetKey | "custom";
  readonly from?: string;
  readonly to?: string;
  readonly compare: boolean;
  /** Point keys, at most {@link MAX_HISTORY_POINTS}. */
  readonly points: readonly string[];
  readonly fn: PointAggregateFunction;
}

function validInstant(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** Reads the page state from the URL; anything unreadable falls back to the 24 h default. */
export function rangeFromSearch(params: URLSearchParams): HistoryRange {
  const from = validInstant(params.get("from"));
  const to = validInstant(params.get("to"));
  const presetKey = HISTORY_PRESETS.find((p) => p.key === params.get("range"))?.key;
  const custom = from !== undefined && to !== undefined && presetKey === undefined;
  const fn = pointAggregateFunctionSchema.safeParse(params.get("fn"));
  const points = [
    ...new Set(
      (params.get("points") ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p !== ""),
    ),
  ].slice(0, MAX_HISTORY_POINTS);
  return {
    range: custom ? "custom" : (presetKey ?? DEFAULT_PRESET),
    ...(custom ? { from, to } : {}),
    compare: params.get("compare") === "1",
    points,
    fn: fn.success ? fn.data : DEFAULT_FN,
  };
}

/** The URL form of {@link HistoryRange}. */
export function rangeToSearch(range: HistoryRange): URLSearchParams {
  const params = new URLSearchParams();
  if (range.range === "custom" && range.from !== undefined && range.to !== undefined) {
    params.set("from", range.from);
    params.set("to", range.to);
  } else {
    params.set("range", range.range === "custom" ? DEFAULT_PRESET : range.range);
  }
  if (range.compare) {
    params.set("compare", "1");
  }
  if (range.points.length > 0) {
    params.set("points", range.points.join(","));
  }
  if (range.fn !== DEFAULT_FN) {
    params.set("fn", range.fn);
  }
  return params;
}

/**
 * The aggregate request for a range: a preset is a trailing `windowMinutes`, a custom range
 * is the `from`/`to` pair (never both — the server refuses that). `_now` is part of the
 * planned signature but unused: a trailing window is anchored by the server's clock.
 */
export function rangeToQuery(
  range: HistoryRange,
  _now: number,
): { windowMinutes: number } | { from: string; to: string } {
  if (range.range === "custom" && range.from !== undefined && range.to !== undefined) {
    return { from: range.from, to: range.to };
  }
  const preset = HISTORY_PRESETS.find((p) => p.key === range.range) ?? HISTORY_PRESETS[1];
  return { windowMinutes: preset.minutes };
}

/**
 * Compare buckets carry their true timestamps; the overlay draws them on the current window,
 * so each moves forward by the span (`to - from`, in ms).
 */
export function shiftCompareBuckets(
  buckets: readonly PointAggregateBucket[],
  spanMs: number,
): PointAggregateBucket[] {
  return buckets.map((b) => ({ ...b, t: new Date(Date.parse(b.t) + spanMs).toISOString() }));
}

/**
 * The previous period's value per current bucket, keyed by the current bucket's start (epoch ms).
 *
 * Each compare bucket moves forward by the span, then snaps down to the `bucketSeconds` grid.
 * The rollups bucket in UTC from the epoch (`time_bucket`), so the floor is that grid. A custom
 * span that is not a whole number of buckets (84 h 30 min at `1h`) would otherwise land every
 * shifted bucket between two current ones, and no current bucket would find its value.
 */
export function previousByBucket(
  compareBuckets: readonly PointAggregateBucket[],
  spanMs: number,
  bucketSeconds: number,
): Map<number, number | null> {
  const widthMs = bucketSeconds * 1000;
  return new Map(
    compareBuckets.map((b) => {
      const shifted = Date.parse(b.t) + spanMs;
      return [Math.floor(shifted / widthMs) * widthMs, b.v] as const;
    }),
  );
}

/**
 * The point keys that can be charted together, in order: a key whose unit would need a third
 * y axis (`axisForUnit`) is dropped. The checkbox refuses that selection on a click; this
 * applies the same rule to a `points` list that arrives in the URL.
 */
export function chartablePoints(
  keys: readonly string[],
  unitOf: (key: string) => string | null,
): string[] {
  const units: (string | null)[] = [];
  const kept: string[] = [];
  for (const key of keys) {
    const unit = unitOf(key);
    if (axisForUnit(units, unit) === "refused") {
      continue;
    }
    units.push(unit);
    kept.push(key);
  }
  return kept;
}

/**
 * Which y axis a series of `unit` belongs on, given the units already plotted: one unit per
 * axis, two axes, a third distinct unit refused. A missing unit counts as a unit of its own.
 */
export function axisForUnit(
  selected: readonly (string | null)[],
  unit: string | null,
): "left" | "right" | "refused" {
  const distinct: (string | null)[] = [];
  for (const u of selected) {
    if (!distinct.includes(u)) {
      distinct.push(u);
    }
  }
  const index = distinct.indexOf(unit);
  if (index === 0) {
    return "left";
  }
  if (index === 1) {
    return "right";
  }
  return distinct.length === 0 ? "left" : distinct.length === 1 ? "right" : "refused";
}

/** A `datetime-local` value read as wall time in the site `timeZone`; `null` when malformed. */
export function localInputToInstant(value: string, timeZone: string): string | null {
  return zoneInputToInstant(value, timeZone);
}

/** An ISO instant as a `datetime-local` value in the site `timeZone`; `""` when invalid. */
export function instantToLocalInput(iso: string | undefined, timeZone: string): string {
  return instantToZoneInput(iso, timeZone);
}
