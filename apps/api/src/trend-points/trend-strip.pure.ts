import {
  type AggregateLevel,
  type TrendPointSegmentDto,
  type TrendStripRange,
  type TrendStripSegmentDto,
  TREND_STRIP_MAX_ASSETS_PER_POINT,
  TREND_STRIP_OVERVIEW_POINTS_PER_SEGMENT,
  TREND_STRIP_RANGES,
} from "@bms/shared";

import { fillBucketGaps } from "../telemetry/point-aggregate-window";
import { bucketSeconds as levelBucketSeconds, levelForRange } from "../telemetry/point-aggregates";

/**
 * `F4.301` U2 / ADR 0108 Amendment 2 — the trend strip's pure arithmetic, with
 * no I/O and `now` an argument everywhere:
 *
 * - {@link stripWindow}: the aligned `[from, to)` window, the declared read
 *   level and the fold width per range (item 5);
 * - {@link pairsFor}: the join of the tab's assets to the effective trend
 *   points of *their own* domain and to their active registrations (items 1, 2);
 * - {@link fitSeries}: the deterministic trim to the server bound — never a 500
 *   (item 6);
 * - {@link assertSeriesRowCount} and {@link groupSeries}: the read's row bound
 *   and the gap-filled response shape.
 *
 * A segment is an `asset_domains` row (data), so nothing here names one — the
 * ADR 0108 §5.4 guard scans this file.
 */

/** The strip's window for one range. */
export type StripWindow = {
  readonly range: TrendStripRange;
  /** Inclusive start: a multiple of `bucketSeconds`. */
  readonly from: Date;
  /** Exclusive end: the start of the in-flight fold, which is never read. */
  readonly to: Date;
  /** The relation read (after the retention guard). */
  readonly level: AggregateLevel;
  /** The width of one output fold. */
  readonly bucketSeconds: number;
  /** Folds per series: exactly `windowMinutes × 60 / bucketSeconds`. */
  readonly buckets: number;
};

/**
 * The start of the `seconds`-wide bucket `instant` falls in, on the 1970 epoch.
 *
 * `floorToBucket` takes a level, and the strip's folds (30 min, 3 h, 12 h) are
 * no level's width, hence this sibling. Every strip width divides 86 400 s, and
 * `time_bucket`'s 2000-01-03 origin is a UTC midnight, so the two alignments
 * agree.
 */
export function floorToSeconds(instant: Date, seconds: number): Date {
  const widthMs = seconds * 1_000;
  return new Date(Math.floor(instant.getTime() / widthMs) * widthMs);
}

/**
 * The aligned window of `range` at `now`: `to` is the last fold boundary at or
 * before `now`, `from = to − window`. The half-open read drops the in-flight
 * fold, so every range returns exactly `buckets` folds.
 *
 * The declared level still passes `levelForRange`, so the retention guard
 * stays one function. A coarsened level wider than the fold could not fill it,
 * so that is refused rather than plotted (unreachable today: `_5m` keeps 735 d).
 */
export function stripWindow(range: TrendStripRange, now: Date): StripWindow {
  const spec = TREND_STRIP_RANGES[range];
  const to = floorToSeconds(now, spec.bucketSeconds);
  const from = new Date(to.getTime() - spec.windowMinutes * 60_000);
  const { level } = levelForRange({ start: from, granularity: spec.level, now });
  if (levelBucketSeconds(level) > spec.bucketSeconds) {
    throw new Error(
      `stripWindow: the ${range} strip folds ${spec.bucketSeconds} s buckets, but retention ` +
        `moved its read to a level ${levelBucketSeconds(level)} s wide; refusing a window it cannot fill.`,
    );
  }
  return {
    range,
    from,
    to,
    level,
    bucketSeconds: spec.bucketSeconds,
    buckets: (spec.windowMinutes * 60) / spec.bucketSeconds,
  };
}

/** A readable asset in the tab's scope. */
export type StripAsset = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** `assets.domain` — the segment the asset's trend points come from. */
  readonly domain: string;
};

/** An active `asset_points` registration, with its effective unit. */
export type StripRegistration = {
  readonly assetId: string;
  readonly pointKey: string;
  /** `COALESCE(asset_points.unit, point_keys.unit)`. */
  readonly unit: string | null;
};

export type PlannedAsset = {
  readonly assetId: string;
  readonly assetCode: string;
  readonly assetName: string;
  readonly unit: string | null;
};

export type PlannedPoint = {
  readonly code: string;
  readonly name: string;
  /** The catalog unit. */
  readonly unit: string | null;
  /** The drawn assets, by asset code, at most `assetsPerPoint`. */
  readonly assets: readonly PlannedAsset[];
  /** Registering assets beyond the drawn ones. */
  readonly moreAssets: number;
};

export type PlannedSegment = {
  readonly domain: string;
  readonly label: string;
  readonly source: TrendPointSegmentDto["source"];
  readonly points: readonly PlannedPoint[];
};

/** The series the strip will read, before the telemetry statement. */
export type StripPlan = {
  readonly segments: readonly PlannedSegment[];
  /** The effective per-point cap. */
  readonly assetsPerPoint: number;
  /** The effective per-segment cap. */
  readonly pointsPerSegment: number;
  readonly trimmed: boolean;
};

export type PairsOptions = {
  /** A whole-site strip (`assetGroupId === null`): the first points per segment only. */
  readonly overview: boolean;
};

function byCode<T extends { code: string }>(a: T, b: T): number {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

/**
 * The asset × trend-point join (Amendment 2 items 1 and 2). A series is
 * `(asset, code)` where `code` is in the effective list of **the asset's own
 * domain** and the asset holds an active registration for it. A listed code
 * no asset registers draws no row, and it does not take one of the overview's
 * places: the overview keeps the first points *that draw*. A segment with no
 * row is absent. `segments` keeps its input order (`forSite`'s
 * `sort_order`, then code); assets are cut by code.
 */
export function pairsFor(
  assets: readonly StripAsset[],
  segments: readonly TrendPointSegmentDto[],
  registrations: readonly StripRegistration[],
  options: PairsOptions,
): StripPlan {
  const unitByPair = new Map<string, string | null>();
  for (const r of registrations) {
    unitByPair.set(pairKey(r.assetId, r.pointKey), r.unit);
  }
  const sortedAssets = [...assets].sort(byCode);
  const assetsPerPoint = TREND_STRIP_MAX_ASSETS_PER_POINT;

  const planned: PlannedSegment[] = [];
  let widest = 0;
  for (const seg of segments) {
    const members = sortedAssets.filter((a) => a.domain === seg.domain);
    const points: PlannedPoint[] = [];
    for (const point of seg.points) {
      const registering = members.filter((a) => unitByPair.has(pairKey(a.id, point.code)));
      if (registering.length === 0) continue;
      points.push({
        code: point.code,
        name: point.name,
        unit: point.unit,
        assets: registering.slice(0, assetsPerPoint).map((a) => ({
          assetId: a.id,
          assetCode: a.code,
          assetName: a.name,
          unit: unitByPair.get(pairKey(a.id, point.code)) ?? null,
        })),
        moreAssets: Math.max(0, registering.length - assetsPerPoint),
      });
    }
    const kept = options.overview ? points.slice(0, TREND_STRIP_OVERVIEW_POINTS_PER_SEGMENT) : points;
    if (kept.length === 0) continue;
    widest = Math.max(widest, kept.length);
    planned.push({ domain: seg.domain, label: seg.label, source: seg.source, points: kept });
  }
  return {
    segments: planned,
    assetsPerPoint,
    pointsPerSegment: options.overview ? TREND_STRIP_OVERVIEW_POINTS_PER_SEGMENT : widest,
    trimmed: false,
  };
}

function pairKey(assetId: string, pointKey: string): string {
  return `${assetId}\u0000${pointKey}`;
}

/** The number of series a plan reads. */
export function seriesCount(plan: StripPlan): number {
  let n = 0;
  for (const seg of plan.segments) {
    for (const point of seg.points) n += point.assets.length;
  }
  return n;
}

/** The `(asset, code)` pairs of a plan, in plan order. */
export function planPairs(plan: StripPlan): { assetId: string; pointKey: string }[] {
  const out: { assetId: string; pointKey: string }[] = [];
  for (const seg of plan.segments) {
    for (const point of seg.points) {
      for (const a of point.assets) out.push({ assetId: a.assetId, pointKey: point.code });
    }
  }
  return out;
}

function capAssets(plan: StripPlan, cap: number): StripPlan {
  return {
    ...plan,
    assetsPerPoint: cap,
    segments: plan.segments.map((seg) => ({
      ...seg,
      points: seg.points.map((point) =>
        point.assets.length <= cap
          ? point
          : { ...point, assets: point.assets.slice(0, cap), moreAssets: point.moreAssets + point.assets.length - cap },
      ),
    })),
  };
}

function capPoints(plan: StripPlan, cap: number): StripPlan {
  return {
    ...plan,
    pointsPerSegment: cap,
    segments: plan.segments.map((seg) => (seg.points.length <= cap ? seg : { ...seg, points: seg.points.slice(0, cap) })),
  };
}

/**
 * The deterministic trim to `max` series (Amendment 2 item 6): lower the
 * assets per point toward 1; if still over, the points per segment toward 1;
 * if still over, drop points from the last segments, in order, until it fits.
 * Every segment stays listed, perhaps with `points: []`. A plan within the
 * bound is returned unchanged.
 */
export function fitSeries(plan: StripPlan, max: number): StripPlan {
  if (seriesCount(plan) <= max) return plan;
  let current = plan;
  for (let cap = plan.assetsPerPoint - 1; cap >= 1; cap -= 1) {
    current = capAssets(current, cap);
    if (seriesCount(current) <= max) return { ...current, trimmed: true };
  }
  for (let cap = current.pointsPerSegment - 1; cap >= 1; cap -= 1) {
    current = capPoints(current, cap);
    if (seriesCount(current) <= max) return { ...current, trimmed: true };
  }
  const segments = current.segments.map((seg) => ({ ...seg, points: [...seg.points] }));
  let count = seriesCount(current);
  for (let s = segments.length - 1; s >= 0 && count > max; s -= 1) {
    const seg = segments[s];
    if (!seg) continue;
    while (seg.points.length > 0 && count > max) {
      const dropped = seg.points.pop();
      count -= dropped?.assets.length ?? 0;
    }
  }
  return { ...current, segments, trimmed: true };
}

/**
 * Refuses a read that returned more rows than its pairs × folds admit. Its own
 * helper because `assertBucketCount` caps at `MAX_BUCKETS` (2 880), below the
 * strip's normal row counts. Reachable only when a relation's bucket width and
 * the declared level disagree, or the window was not aligned; a chart would
 * then plot a shifted window.
 */
export function assertSeriesRowCount(rowCount: number, expected: number): void {
  if (rowCount > expected) {
    throw new Error(
      `trend strip read returned ${rowCount} rows, past the ${expected} its pairs and folds admit. ` +
        "A relation's bucket width and the declared level disagree, or the window is not aligned; " +
        "refusing rather than plotting a shifted window.",
    );
  }
}

/** One row of the strip's telemetry read. */
export type StripRow = {
  readonly assetId: string;
  readonly pointKey: string;
  /** The fold start, ISO-8601. */
  readonly t: string;
  readonly v: number | null;
};

/** The plan with every series gap-filled to `window.buckets` folds, in the response shape. */
export function groupSeries(plan: StripPlan, rows: readonly StripRow[], window: StripWindow): TrendStripSegmentDto[] {
  const byPair = new Map<string, { t: string; v: number | null }[]>();
  for (const row of rows) {
    const key = pairKey(row.assetId, row.pointKey);
    const list = byPair.get(key) ?? [];
    list.push({ t: row.t, v: row.v });
    byPair.set(key, list);
  }
  return plan.segments.map((seg) => ({
    domain: seg.domain,
    label: seg.label,
    source: seg.source,
    points: seg.points.map((point) => ({
      code: point.code,
      name: point.name,
      unit: point.unit,
      moreAssets: point.moreAssets,
      assets: point.assets.map((a) => ({
        assetId: a.assetId,
        assetCode: a.assetCode,
        assetName: a.assetName,
        unit: a.unit,
        buckets: fillBucketGaps(byPair.get(pairKey(a.assetId, point.code)) ?? [], window.from, window.to, window.bucketSeconds),
      })),
    })),
  }));
}
