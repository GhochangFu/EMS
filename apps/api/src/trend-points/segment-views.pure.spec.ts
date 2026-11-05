import { NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import {
  BASELINE_WINDOWS,
  SEGMENT_RANKING_MAX,
  SEGMENT_VIEW_SERIES_MAX,
  resolveSiteTimeZone,
  type TrendPointSegmentDto,
} from "@bms/shared";

import type { SegmentWindowRow } from "./segment-abnormal";
import {
  SEGMENT_NOT_FOUND,
  SEGMENT_POINT_NOT_FOUND,
  candidatesFor,
  fillSeries,
  pickPoint,
  pickSegment,
  rankingOf,
  readWindows,
  segmentFrame,
  segmentsPresent,
} from "./segment-views.pure";
import type { SiteAssetRow } from "./site-asset-rows";

/**
 * `F4.302` U2 (ADR 0108 Amendment 4 items 2 and 4) — the segment view's pure
 * rules: which segments a site shows, the default segment and point and their
 * 404s, the candidates, the range frame (one level from the oldest consulted
 * window), the ranking and its caps, and the display gap-fill. Vitest entry
 * point: the sibling `.test.ts`.
 *
 * A spec may name a segment or a point: the ADR 0108 §5.4 guard scans runtime
 * modules only.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const NOW = new Date("2026-11-02T10:47:13.250Z");
const KOLKATA = resolveSiteTimeZone("Asia/Kolkata", null);

function point(code: string) {
  return { code, name: `Name ${code}`, unit: "kW", active: true };
}

function segment(domain: string, codes: string[]): TrendPointSegmentDto {
  return {
    domain,
    label: `Label ${domain}`,
    source: "catalog",
    points: codes.map(point),
    catalogDefaults: [],
    updatedAt: null,
    updatedBy: null,
  };
}

/** `forSite`'s order: `hvac` before `ups` before `water`. */
const SITE = [segment("hvac", ["kw", "supply_air_temp_c"]), segment("ups", ["backup_min"]), segment("water", ["flow"])];

function uuid(n: number): string {
  return `30000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function assetRow(n: number, domain: string, pointKey: string, code = `A${String(n).padStart(3, "0")}`): SiteAssetRow {
  return {
    asset_id: uuid(n),
    asset_code: code,
    asset_name: `Asset ${code}`,
    // C1 has no RTU (ADR 0111's RTU-less twin); the others sit on RTU <n>.
    asset_rtu_name: code === "C1" ? null : `RTU ${n}`,
    asset_location_name: "Site 1",
    domain,
    point_key: pointKey,
    unit: "kW",
  };
}

/** Code order (the read's `ORDER BY a.code`): a `ups` asset first, two `hvac` assets, one in an inactive domain. */
const ROWS: SiteAssetRow[] = [
  assetRow(1, "ups", "backup_min", "A1"),
  assetRow(2, "hvac", "kw", "B1"),
  assetRow(2, "hvac", "supply_air_temp_c", "B1"),
  assetRow(3, "hvac", "kw", "C1"),
  assetRow(4, "retired_domain", "kw", "D1"),
];

/** The site's segments are the distinct domains of its rows, in `forSite` order, with an asset count; an inactive domain is left out. */
export function assertSegmentsFollowForSiteOrder(): void {
  expect(segmentsPresent(SITE, ROWS)).toEqual([
    { domain: "hvac", label: "Label hvac", assetCount: 2 },
    { domain: "ups", label: "Label ups", assetCount: 1 },
  ]);
}

/** No `segment` asked: the first present segment, not the first of `forSite` when it has no asset. */
export function assertTheDefaultSegmentIsTheFirstPresent(): void {
  const present = segmentsPresent([segment("water", ["flow"]), ...SITE.slice(0, 2)], ROWS);
  expect(pickSegment(SITE, present, undefined)?.domain).toBe("hvac");
}

/** No segment at the site and none asked: `null`, not a 404. */
export function assertNoSegmentPresentIsNull(): void {
  expect(pickSegment(SITE, [], undefined)).toBeNull();
}

/** A `segment` that is not an active segment of the site's organization is the 404. */
export function assertAnUnknownSegmentIsA404(): void {
  const err = refusal(() => pickSegment(SITE, segmentsPresent(SITE, ROWS), "retired_domain"));
  expect(err).toBeInstanceOf(NotFoundException);
  expect(err.message).toBe(SEGMENT_NOT_FOUND);
}

/** No `point` asked: the first code of the segment's effective list. */
export function assertTheDefaultPointIsTheFirstOfTheList(): void {
  expect(pickPoint(SITE[0] as TrendPointSegmentDto, undefined)?.code).toBe("kw");
  expect(pickPoint(SITE[0] as TrendPointSegmentDto, "supply_air_temp_c")?.code).toBe("supply_air_temp_c");
}

/** A `point` outside the segment's effective list is the 404, though another segment lists it. */
export function assertAPointOutsideTheListIsA404(): void {
  const err = refusal(() => pickPoint(SITE[0] as TrendPointSegmentDto, "backup_min"));
  expect(err).toBeInstanceOf(NotFoundException);
  expect(err.message).toBe(SEGMENT_POINT_NOT_FOUND);
}

/** The candidates are the segment's assets registering the point, one each, by code. */
export function assertCandidatesAreTheSegmentsRegistrations(): void {
  expect(candidatesFor(ROWS, "hvac", "kw").map((a) => a.assetCode)).toEqual(["B1", "C1"]);
  expect(candidatesFor(ROWS, "hvac", "supply_air_temp_c").map((a) => a.assetCode)).toEqual(["B1"]);
  expect(candidatesFor(ROWS, "ups", "kw")).toEqual([]);
}

/** `F4.316` (ADR 0111) — a candidate carries its row's RTU and location names; the RTU-less C1 a null RTU name. */
export function assertACandidateCarriesItsRtuAndLocationNames(): void {
  expect(candidatesFor(ROWS, "hvac", "kw").map((a) => [a.assetCode, a.assetRtuName, a.assetLocationName])).toEqual([
    ["B1", "RTU 2", "Site 1"],
    ["C1", null, "Site 1"],
  ]);
}

function stats(assetId: string, idx: number, mean: number, max = mean): SegmentWindowRow {
  return { assetId, idx, mean, max, maxAt: "2026-11-02T08:00:00.000Z", sampleCount: 10, bucketCount: 10 };
}

function assets(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    assetId: uuid(i + 1),
    assetCode: `A${String(i + 1).padStart(3, "0")}`,
    assetName: `Asset ${i + 1}`,
    assetRtuName: null,
    assetLocationName: null,
    unit: "kW",
  }));
}

/** Ranked by mean descending; a tie orders by code, not by the order the rows came in. */
export function assertTheRankingIsByMeanThenCode(): void {
  const list = assets(3);
  const ranking = rankingOf(list, [stats(uuid(3), 0, 5), stats(uuid(2), 0, 9), stats(uuid(1), 0, 5)]);
  expect(ranking.ranked.map((r) => r.assetCode)).toEqual(["A002", "A001", "A003"]);
}

/** An asset with no current row is not ranked. */
export function assertAnAssetWithoutACurrentRowIsNotRanked(): void {
  const ranking = rankingOf(assets(2), [stats(uuid(1), 0, 5), stats(uuid(2), 1, 9)]);
  expect(ranking.ranked.map((r) => r.assetId)).toEqual([uuid(1)]);
}

function sixty() {
  const list = assets(60);
  return rankingOf(
    list,
    list.map((a, i) => stats(a.assetId, 0, 100 - i)),
  );
}

/** Sixty ranked assets: 50 sent, `moreAssets` 10. */
export function assertTheRankingIsCutAtFifty(): void {
  expect(SEGMENT_RANKING_MAX).toBe(50);
  const ranking = sixty();
  expect(ranking.ranked).toHaveLength(50);
  expect(ranking.moreAssets).toBe(10);
  expect(ranking.ranked.at(-1)?.assetCode).toBe("A050");
}

/** The top 8 by mean draw series, and `trimmed` says more could. */
export function assertTheTopEightDrawSeries(): void {
  expect(SEGMENT_VIEW_SERIES_MAX).toBe(8);
  const ranking = sixty();
  expect(ranking.seriesIds).toEqual(assets(8).map((a) => a.assetId));
  expect(ranking.trimmed).toBe(true);
}

/** Eight ranked assets all draw, and nothing is trimmed. */
export function assertEightAssetsAreNotTrimmed(): void {
  const list = assets(8);
  const ranking = rankingOf(
    list,
    list.map((a, i) => stats(a.assetId, 0, i)),
  );
  expect(ranking.seriesIds).toHaveLength(8);
  expect(ranking.trimmed).toBe(false);
}

/** `compare` is the asset's `idx −1` row, or `null` without one (ruling 4.6). */
export function assertCompareIsNullWithoutAPreviousRow(): void {
  const ranking = rankingOf(assets(2), [
    stats(uuid(1), 0, 9),
    stats(uuid(1), -1, 6, 7),
    stats(uuid(2), 0, 5),
    stats(uuid(2), 1, 5),
  ]);
  expect(ranking.ranked.map((r) => r.compare)).toEqual([
    { mean: 6, max: 7, maxAt: "2026-11-02T08:00:00.000Z", sampleCount: 10 },
    null,
  ]);
}

/** One level for every period: chosen from the oldest consulted window's start, the fourth baseline window. */
export function assertOlderStartIsTheOldestConsultedWindow(): void {
  const frame = segmentFrame({ range: "24h", compare: "previous" }, KOLKATA, NOW);
  expect(frame.consulted).toHaveLength(BASELINE_WINDOWS);
  expect(frame.olderStart.toISOString()).toBe(new Date(NOW.getTime() - 5 * DAY_MS).toISOString());
}

/** A 46-day custom range reads `_1h` in local-day buckets. */
export function assertA46DayCustomRangeIsHourLevelDayBucket(): void {
  const to = NOW.toISOString();
  const from = new Date(NOW.getTime() - 46 * DAY_MS).toISOString();
  const frame = segmentFrame({ range: "custom", from, to }, KOLKATA, NOW);
  expect([frame.level, frame.bucket]).toEqual(["1h", "1d"]);
}

/** A custom 2 h range 733.5 days back: three baseline windows start past `_1m`'s 735-day horizon and are dropped. */
export function assertAWindowPastRetentionIsDropped(): void {
  const start = new Date(NOW.getTime() - 733.5 * DAY_MS);
  const frame = segmentFrame(
    { range: "custom", from: start.toISOString(), to: new Date(start.getTime() + 2 * HOUR_MS).toISOString() },
    KOLKATA,
    NOW,
  );
  expect(frame.windows).toHaveLength(BASELINE_WINDOWS);
  expect(frame.consulted.map((w) => w.idx)).toEqual([1]);
  expect(frame.level).toBe("1m");
}

/** Statement A's windows: `idx 0` the current period, `−1` the compare period when asked, then the consulted windows. */
export function assertReadWindowsCarryCurrentCompareAndBaseline(): void {
  const withCompare = segmentFrame({ range: "24h", compare: "previous" }, KOLKATA, NOW);
  expect(readWindows(withCompare).map((w) => w.idx)).toEqual([0, -1, 1, 2, 3, 4]);
  const without = segmentFrame({ range: "24h" }, KOLKATA, NOW);
  expect(readWindows(without).map((w) => w.idx)).toEqual([0, 1, 2, 3, 4]);
}

/** A level bucket is gap-filled at the level's width over the inclusive period, with `null` where no row is. */
export function assertALevelSeriesIsGapFilled(): void {
  const start = new Date("2026-11-02T00:00:00.000Z");
  const end = new Date("2026-11-02T02:59:59.999Z");
  const filled = fillSeries([{ t: "2026-11-02T01:00:00.000Z", v: 4 }], { start, end, durationHours: 3 }, "1h", "1h", KOLKATA);
  expect(filled).toEqual([
    { t: "2026-11-02T00:00:00.000Z", v: null },
    { t: "2026-11-02T01:00:00.000Z", v: 4 },
    { t: "2026-11-02T02:00:00.000Z", v: null },
  ]);
}

/** A `1d` bucket over `_1h` is a local day: Kolkata midnights (18:30Z), from the day holding the start. */
export function assertADaySeriesIsFilledByLocalMidnight(): void {
  const start = new Date("2026-10-30T20:00:00.000Z"); // 31 Oct 01:30 IST
  const end = new Date("2026-11-01T10:00:00.000Z"); // 1 Nov 15:30 IST
  const filled = fillSeries([{ t: "2026-10-31T18:30:00.000Z", v: 2 }], { start, end, durationHours: 38 }, "1h", "1d", KOLKATA);
  expect(filled).toEqual([
    { t: "2026-10-30T18:30:00.000Z", v: null },
    { t: "2026-10-31T18:30:00.000Z", v: 2 },
  ]);
}

function refusal(run: () => unknown): Error {
  try {
    run();
  } catch (err) {
    return err as Error;
  }
  throw new Error("returned, expected a refusal");
}
