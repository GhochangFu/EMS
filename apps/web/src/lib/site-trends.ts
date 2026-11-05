import {
  BASELINE_WINDOWS,
  CATALOG_CODE_PATTERN,
  MIN_BASELINE_WINDOWS,
  SITE_TRENDS_ENERGY_VIEW,
  assetLabelOf,
  type EnergyViewQuery,
  type SegmentAbnormalBaselineDto,
  type SegmentAbnormalEntryDto,
  type SegmentViewPeriodDto,
  type SegmentViewRankingEntryDto,
  type SiteSegmentViewsQuery,
} from "@bms/shared";

import type { RangeCompareValue } from "../components/energy/range-compare-controls";
import { assetHistoryPath, shiftCompareBuckets } from "./asset-history-range";

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 items 3, 7, 8) — the Trends & Energy section's pure rules:
 * the two queries it sends, the sub-tab search's `view` and `point` readers (ids and codes only;
 * since `F4.303` the one writer of the section's search is `view-links.ts`), the history link, the chart series, the ranking sort and change, and the abnormal
 * sentences. No segment is named here: a sub-tab is whatever domain the segment read returns.
 */

/** The `?view=` value of the Energy sub-tab, and the default (reserved as a domain code: `SITE_TRENDS_ENERGY_VIEW`). */
export const ENERGY_VIEW = SITE_TRENDS_ENERGY_VIEW;

function catalogCode(value: string | null): string | undefined {
  return value !== null && CATALOG_CODE_PATTERN.test(value) ? value : undefined;
}

/** `?view=`: the Energy sub-tab when absent or not a catalog code, else the domain code. */
export function viewFromSearch(params: URLSearchParams): string {
  return catalogCode(params.get("view")) ?? ENERGY_VIEW;
}

/** `?point=`: a catalog code, or `undefined` (the segment's first point). */
export function pointFromSearch(params: URLSearchParams): string | undefined {
  return catalogCode(params.get("point"));
}

/** The range part both queries share, or `null` for a custom range without both ends. */
function rangePart(value: RangeCompareValue): Pick<EnergyViewQuery, "range" | "from" | "to"> | null {
  if (value.range !== "custom") {
    return { range: value.range };
  }
  if (value.from === undefined || value.to === undefined) {
    return null;
  }
  return { range: value.range, from: value.from, to: value.to };
}

/**
 * The Energy sub-tab's `energy/view` and `organization-views` query: the site as the one
 * `locationIds` entry and **never** `organizationId`, so the place and its grant check resolve
 * from the named location and the zone is the site's (item 3).
 */
export function siteEnergyQueryOf(locationId: string, value: RangeCompareValue): EnergyViewQuery | null {
  const range = rangePart(value);
  if (range === null) {
    return null;
  }
  const query: EnergyViewQuery = { range: range.range, locationIds: [locationId] };
  if (range.from !== undefined && range.to !== undefined) {
    query.from = range.from;
    query.to = range.to;
  }
  if (value.compare !== undefined) {
    query.compare = value.compare;
  }
  return query;
}

/**
 * The segment read's query. On the Energy sub-tab it names no segment, so the server answers the
 * first one and the nav still knows every segment (plan C9); on a segment sub-tab it names the
 * segment and the chosen point.
 */
export function segmentViewsQueryOf(
  view: string,
  point: string | undefined,
  value: RangeCompareValue,
): SiteSegmentViewsQuery | null {
  const range = rangePart(value);
  if (range === null) {
    return null;
  }
  const query: SiteSegmentViewsQuery = { range: range.range };
  if (view !== ENERGY_VIEW) {
    query.segment = view;
    if (point !== undefined) {
      query.point = point;
    }
  }
  if (range.from !== undefined && range.to !== undefined) {
    query.from = range.from;
    query.to = range.to;
  }
  if (value.compare !== undefined) {
    query.compare = value.compare;
  }
  return query;
}

/** The asset history page over the exact window, the point, and `compare=1` when on (item 7). */
export function historyHrefFor(
  assetId: string,
  period: { readonly from: string; readonly to: string },
  pointCode: string,
  compare: boolean,
): string {
  const params = new URLSearchParams({ from: period.from, to: period.to, points: pointCode });
  if (compare) {
    params.set("compare", "1");
  }
  return `${assetHistoryPath(assetId)}?${params}`;
}

/** How far the compare buckets move to overlay the current period, in ms; 0 without one. */
export function compareSpanMs(current: SegmentViewPeriodDto, compare: SegmentViewPeriodDto | null): number {
  return compare === null ? 0 : Date.parse(current.from) - Date.parse(compare.from);
}

/** One line of the segment chart; `dashed` is the asset's previous period. */
export type SegmentChartSeries = {
  readonly assetId: string;
  /** `F4.316` (ADR 0111) — `assetLabelOf(entry)`, `<code> · <RTU>` (or the location without one). */
  readonly label: string;
  readonly dashed: boolean;
  readonly data: [string, number | null][];
};

/**
 * The chart's lines: one per asset that carries buckets (the server's top assets), each followed
 * by its previous period when sent, moved forward by `spanMs` (decision 1.3).
 */
export function segmentChartSeries(
  ranking: readonly SegmentViewRankingEntryDto[],
  spanMs: number,
): SegmentChartSeries[] {
  return ranking.flatMap((entry) => {
    if (entry.buckets === null) {
      return [];
    }
    const own: SegmentChartSeries = {
      assetId: entry.assetId,
      label: assetLabelOf(entry),
      dashed: false,
      data: entry.buckets.map((b) => [b.t, b.v]),
    };
    if (entry.compareBuckets === null) {
      return [own];
    }
    const previous: SegmentChartSeries = {
      assetId: entry.assetId,
      label: own.label,
      dashed: true,
      data: shiftCompareBuckets(entry.compareBuckets, spanMs).map((b) => [b.t, b.v]),
    };
    return [own, previous];
  });
}

export type RankingSort = "mean" | "max";

/**
 * `mean` keeps the server's order (mean desc, ties by code); `max` sorts by max desc, ties by code
 * — the code, not the `F4.316` label, so an RTU's name never reorders a tie.
 */
export function sortRanking(
  ranking: readonly SegmentViewRankingEntryDto[],
  by: RankingSort,
): SegmentViewRankingEntryDto[] {
  if (by === "mean") {
    return [...ranking];
  }
  return [...ranking].sort(
    (a, b) => b.current.max - a.current.max || a.assetCode.localeCompare(b.assetCode),
  );
}

/**
 * The mean's change against the previous period, in percent of the previous magnitude;
 * `undefined` without a compare row (ruling 4.6), `null` when the previous mean is zero.
 */
export function meanChangePct(entry: SegmentViewRankingEntryDto): number | null | undefined {
  if (entry.compare === null) {
    return undefined;
  }
  const before = entry.compare.mean;
  if (before === 0) {
    return null;
  }
  return ((entry.current.mean - before) / Math.abs(before)) * 100;
}

/** The verdict sentence of one abnormal entry (item 5); two negatives say they compare by magnitude. */
export function segmentVerdictSentence(entry: SegmentAbnormalEntryDto): string {
  switch (entry.verdict) {
    case "above":
    case "below": {
      const ratio = entry.ratio === null ? "—" : `${entry.ratio.toFixed(2)}×`;
      const magnitude =
        entry.currentMean < 0 && entry.baselineMean !== null && entry.baselineMean < 0
          ? " by magnitude (both negative)"
          : "";
      return `${ratio} the baseline${magnitude} — ${entry.verdict} its normal`;
    }
    case "not_comparable":
      return "Not comparable — the baseline is near zero or of the opposite sign";
    case "not_enough_history":
      return `Not enough history — ${entry.baselineWindows} of ${BASELINE_WINDOWS} windows hold enough data; ${MIN_BASELINE_WINDOWS} are needed`;
  }
}

/** The one line that says what abnormal means for a segment point: both sides of the band. */
export function segmentBaselineSentence(baseline: SegmentAbnormalBaselineDto): string {
  const above = Math.round((baseline.ratio - 1) * 100);
  const below = Math.round((1 - baseline.belowRatio) * 100);
  const head = `≥ ${above} % above or ≥ ${below} % below the median of the same window`;
  if (baseline.windowsConsulted < baseline.windows) {
    return `${head}; only ${baseline.windowsConsulted} of ${baseline.windows} windows is within the retained history at this detail level`;
  }
  if (baseline.stepDays === 1) {
    return `${head} on the ${baseline.windows} preceding days`;
  }
  return `${head} in the ${baseline.windows} preceding ${baseline.stepDays}-day windows`;
}
