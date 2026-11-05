import { NotFoundException } from "@nestjs/common";

import {
  BASELINE_WINDOWS,
  SEGMENT_RANKING_MAX,
  SEGMENT_VIEW_SERIES_MAX,
  type AggregateLevel,
  type ResolvedSiteTimeZone,
  type SegmentViewSegmentRefDto,
  type SegmentViewStatsDto,
  type SiteSegmentViewsQuery,
  type TrendPointSegmentDto,
} from "@bms/shared";

import { type BaselineWindow, baselineWindows, windowsWithinHorizon } from "../reports/energy-abnormal";
import {
  type EnergyViewPeriodRange,
  displayBucketFor,
  levelAndBucketFor,
  previousPeriod,
  resolveEnergyRange,
} from "../reports/energy-view-range";
import { addLocalDays, localDateOf, toInstant } from "../reports/report-period";
import { fillBucketGaps } from "../telemetry/point-aggregate-window";
import { bucketSeconds } from "../telemetry/point-aggregates";
import type { SegmentAsset, SegmentWindowRow } from "./segment-abnormal";
import type { SiteAssetRow } from "./site-asset-rows";

/**
 * `F4.302` U2 (ADR 0108 Amendment 4 items 2 and 4) — the segment view's pure
 * rules, no I/O: the segments a site shows, the default segment and point and
 * their 404s, the candidates, the range frame, the ranking and its caps, and
 * the display gap-fill. Nothing here names a segment or a point: both are data
 * (§5.2).
 *
 * **One range rule.** The frame calls `F4.298`'s pure `resolveEnergyRange`,
 * `previousPeriod`, `displayBucketFor` and `levelAndBucketFor` and `F4.299`'s
 * `baselineWindows` and `windowsWithinHorizon` with the site zone, so no second
 * copy of those rules exists. `ReportsModule` is not imported: these are plain
 * functions.
 */

export const SEGMENT_NOT_FOUND = "Segment not found at this site";
export const SEGMENT_POINT_NOT_FOUND = "Point not in this segment's trend points";

const MAX_LOCAL_DAYS = 367;

/**
 * The segments present at the site: the distinct `domain` of the readable rows,
 * in `forSite` order (`asset_domains.sort_order`, then code), with their asset
 * count. A domain that is not an active segment of `forSite` is left out.
 */
export function segmentsPresent(
  site: readonly TrendPointSegmentDto[],
  rows: readonly SiteAssetRow[],
): SegmentViewSegmentRefDto[] {
  const assetsByDomain = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = assetsByDomain.get(row.domain) ?? new Set<string>();
    set.add(row.asset_id);
    assetsByDomain.set(row.domain, set);
  }
  return site
    .filter((segment) => assetsByDomain.has(segment.domain))
    .map((segment) => ({
      domain: segment.domain,
      label: segment.label,
      assetCount: assetsByDomain.get(segment.domain)?.size ?? 0,
    }));
}

/**
 * The segment shown. Asked: it must be an active segment of the site's
 * organization (the 404 otherwise, before the scope); not asked: the first
 * present segment, or `null` when none is.
 */
export function pickSegment(
  site: readonly TrendPointSegmentDto[],
  present: readonly SegmentViewSegmentRefDto[],
  requested: string | undefined,
): TrendPointSegmentDto | null {
  if (requested !== undefined) {
    const found = site.find((segment) => segment.domain === requested);
    if (!found) {
      throw new NotFoundException(SEGMENT_NOT_FOUND);
    }
    return found;
  }
  const first = present[0];
  return first === undefined ? null : (site.find((segment) => segment.domain === first.domain) ?? null);
}

/** The point shown: asked, it must be in the segment's effective list (the 404 otherwise); else the list's first. */
export function pickPoint(
  segment: TrendPointSegmentDto | null,
  requested: string | undefined,
): TrendPointSegmentDto["points"][number] | null {
  const points = segment?.points ?? [];
  if (requested !== undefined) {
    const found = points.find((point) => point.code === requested);
    if (!found) {
      throw new NotFoundException(SEGMENT_POINT_NOT_FOUND);
    }
    return found;
  }
  return points[0] ?? null;
}

/** One candidate per readable asset of `domain` with an active registration of `pointKey`, by code. */
export function candidatesFor(rows: readonly SiteAssetRow[], domain: string, pointKey: string): SegmentAsset[] {
  const byId = new Map<string, SegmentAsset>();
  for (const row of rows) {
    if (row.domain !== domain || row.point_key !== pointKey || byId.has(row.asset_id)) continue;
    byId.set(row.asset_id, {
      assetId: row.asset_id,
      assetCode: row.asset_code,
      assetName: row.asset_name,
      assetRtuName: row.asset_rtu_name,
      assetLocationName: row.asset_location_name,
      unit: row.unit,
    });
  }
  return [...byId.values()].sort((a, b) =>
    a.assetCode !== b.assetCode ? (a.assetCode < b.assetCode ? -1 : 1) : a.assetId < b.assetId ? -1 : 1,
  );
}

export type SegmentFrame = {
  readonly current: EnergyViewPeriodRange;
  readonly previous: EnergyViewPeriodRange | null;
  readonly stepDays: number;
  /** Every baseline window, `idx 1..BASELINE_WINDOWS`. */
  readonly windows: readonly BaselineWindow[];
  /** The windows inside the read level's retention horizon: the ones statement A reads. */
  readonly consulted: readonly BaselineWindow[];
  /** The oldest start the read covers: the one `levelForRange` is called with. */
  readonly olderStart: Date;
  readonly level: AggregateLevel;
  readonly bucket: AggregateLevel;
};

function oldest(dates: readonly Date[]): Date {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

/**
 * The range frame, in the site zone: the current and compare periods, the
 * baseline windows, then one level for all of them. The horizon is first taken
 * at the display bucket's own granularity; the level is chosen once from the
 * oldest start among the current period, the compare period and the consulted
 * windows; if retention coarsens it, the horizon is re-taken at that level, so
 * every consulted window is one the read level still holds.
 */
export function segmentFrame(
  query: Pick<SiteSegmentViewsQuery, "range" | "from" | "to" | "compare">,
  zone: ResolvedSiteTimeZone,
  now: Date,
): SegmentFrame {
  const current = resolveEnergyRange(query, zone, now);
  const previous = query.compare === "previous" ? previousPeriod(current) : null;
  const { stepDays, windows } = baselineWindows(current, zone.arithmeticZone, BASELINE_WINDOWS);
  const display = displayBucketFor(current.durationHours);
  const granularity: AggregateLevel = display === "1d" ? "1h" : display;
  const within = windowsWithinHorizon(windows, granularity, now);
  const olderStart = oldest([current.start, ...(previous ? [previous.start] : []), ...within.map((w) => w.start)]);
  const { level, bucket } = levelAndBucketFor({ bucket: display, olderStart, now });
  const consulted = level === granularity ? within : windowsWithinHorizon(windows, level, now);
  return { current, previous, stepDays, windows, consulted, olderStart, level, bucket };
}

/** Statement A's windows: `idx 0` the current period, `−1` the compare period when asked, then the consulted windows. */
export function readWindows(frame: SegmentFrame): BaselineWindow[] {
  return [
    { idx: 0, start: frame.current.start, end: frame.current.end },
    ...(frame.previous ? [{ idx: -1, start: frame.previous.start, end: frame.previous.end }] : []),
    ...frame.consulted,
  ];
}

export type RankedAsset = SegmentAsset & {
  readonly current: SegmentViewStatsDto;
  readonly compare: SegmentViewStatsDto | null;
};

export type SegmentRanking = {
  /** At most `SEGMENT_RANKING_MAX`, by mean descending, ties by code. */
  readonly ranked: RankedAsset[];
  readonly moreAssets: number;
  /** The first `SEGMENT_VIEW_SERIES_MAX` of the ranking: statement B's assets. */
  readonly seriesIds: string[];
  /** More assets have a current row than draw a series. */
  readonly trimmed: boolean;
};

function statsOf(row: SegmentWindowRow): SegmentViewStatsDto {
  return { mean: row.mean, max: row.max, maxAt: row.maxAt, sampleCount: row.sampleCount };
}

/**
 * The ranking from statement A's `idx 0` rows (an asset without one is not
 * ranked), with `compare` from the same asset's `idx −1` row or `null`
 * (ruling 4.6). The caps trim, never throw.
 */
export function rankingOf(assets: readonly SegmentAsset[], rows: readonly SegmentWindowRow[]): SegmentRanking {
  const current = new Map<string, SegmentWindowRow>();
  const compare = new Map<string, SegmentWindowRow>();
  for (const row of rows) {
    if (row.idx === 0) current.set(row.assetId, row);
    else if (row.idx === -1) compare.set(row.assetId, row);
  }
  const all: RankedAsset[] = [];
  for (const asset of assets) {
    const row = current.get(asset.assetId);
    if (!row) continue;
    const previous = compare.get(asset.assetId);
    all.push({ ...asset, current: statsOf(row), compare: previous ? statsOf(previous) : null });
  }
  all.sort(
    (a, b) =>
      b.current.mean - a.current.mean ||
      (a.assetCode !== b.assetCode ? (a.assetCode < b.assetCode ? -1 : 1) : a.assetId < b.assetId ? -1 : 1),
  );
  return {
    ranked: all.slice(0, SEGMENT_RANKING_MAX),
    moreAssets: Math.max(0, all.length - SEGMENT_RANKING_MAX),
    seriesIds: all.slice(0, SEGMENT_VIEW_SERIES_MAX).map((asset) => asset.assetId),
    trimmed: all.length > SEGMENT_VIEW_SERIES_MAX,
  };
}

/**
 * One series gap-filled over an inclusive period. A level bucket is
 * `fillBucketGaps` at the level's width (epoch-aligned, the first bucket at or
 * after `start`, as `bucket >= start` admits); a `1d` bucket over `_1h` is a
 * local day, so the fill is the zone's midnights from the day holding `start`
 * to the day holding `end` — `time_bucket(INTERVAL '1 day', …, zone)`'s own
 * alignment.
 */
export function fillSeries(
  rows: readonly { t: string; v: number | null }[],
  period: EnergyViewPeriodRange,
  level: AggregateLevel,
  bucket: AggregateLevel,
  zone: ResolvedSiteTimeZone,
): { t: string; v: number | null }[] {
  if (bucket === level) {
    return fillBucketGaps(rows, period.start, new Date(period.end.getTime() + 1), bucketSeconds(level));
  }
  const tz = zone.arithmeticZone;
  const byStart = new Map(rows.map((row) => [new Date(row.t).getTime(), row.v]));
  const last = localDateOf(period.end, tz);
  const filled: { t: string; v: number | null }[] = [];
  // Bounded: a custom range is at most 365 days, so 367 local days is the most a period spans.
  for (let day = localDateOf(period.start, tz), i = 0; i < MAX_LOCAL_DAYS; day = addLocalDays(day, 1), i += 1) {
    const at = toInstant(day, { hour: 0, minute: 0 }, tz);
    filled.push({ t: at.toISOString(), v: byStart.get(at.getTime()) ?? null });
    if (day.year === last.year && day.month === last.month && day.day === last.day) break;
  }
  return filled;
}
