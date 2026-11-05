import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

import {
  ABNORMAL_BELOW_RATIO,
  ABNORMAL_LIST_MAX,
  ABNORMAL_NEAR_ZERO_FRACTION,
  ABNORMAL_RATIO,
  BASELINE_WINDOWS,
  type JwtPayload,
  type ResolvedSiteTimeZone,
  SEGMENT_VIEW_SERIES_MAX,
  type SegmentViewRankingEntryDto,
  type SegmentViewSegmentRefDto,
  type SiteSegmentViewsDto,
  type SiteSegmentViewsQuery,
  type TrendPointSegmentDto,
} from "@bms/shared";

import { MAX_EXPORT_ROWS } from "../admin/audit/audit.limits";
import { AccessControlService } from "../auth/access-control.service";
import { FLEET_POOL } from "../database/database.tokens";
import type { EnergyViewPeriodRange } from "../reports/energy-view-range";
import {
  type ViewExportRow,
  assertViewExportWithinCap,
  segmentViewExportRows,
  viewExportCsv,
  viewExportXlsx,
} from "../reports/view-export.serialise";
import { bucketSeconds } from "../telemetry/point-aggregates";
import { type SegmentAsset, orderAndTrimSegment, segmentAbnormalEntries } from "./segment-abnormal";
import { type SegmentSeriesRow, segmentSeriesRead, segmentWindowReads } from "./segment-views-read";
import {
  candidatesFor,
  fillSeries,
  pickPoint,
  pickSegment,
  rankingOf,
  readWindows,
  type SegmentFrame,
  segmentFrame,
  segmentsPresent,
} from "./segment-views.pure";
import { siteAssetRows, siteTimeZone } from "./site-asset-rows";
import { TrendPointsService } from "./trend-points.service";

function bounds(range: EnergyViewPeriodRange): { from: string; to: string; durationHours: number } {
  return { from: range.start.toISOString(), to: range.end.toISOString(), durationHours: range.durationHours };
}

/**
 * `F4.303` U4 — what `frameFor` resolves before the first telemetry statement:
 * the site's zone and range frame, the segments in scope, the chosen segment
 * and point, and the candidate assets.
 */
export type SegmentViewsReadFrame = {
  readonly locationId: string;
  readonly now: Date;
  readonly zone: ResolvedSiteTimeZone;
  readonly frame: SegmentFrame;
  readonly segments: SegmentViewSegmentRefDto[];
  readonly segment: TrendPointSegmentDto | null;
  readonly point: TrendPointSegmentDto["points"][number] | null;
  readonly candidates: SegmentAsset[];
};

/**
 * `F4.303` U4 (ADR 0108 Amendment 6 item 3; plan C4) — the rows the segment
 * export can hold, from the frame alone, before any telemetry statement: at
 * most `SEGMENT_VIEW_SERIES_MAX` drawn series × the display buckets × the
 * periods.
 */
export function segmentViewExportRowCount(frame: Pick<SegmentFrame, "current" | "previous" | "bucket">): number {
  const buckets = Math.ceil((frame.current.durationHours * 3600) / bucketSeconds(frame.bucket));
  const periods = frame.previous === null ? 1 : 2;
  return SEGMENT_VIEW_SERIES_MAX * buckets * periods;
}

/**
 * `F4.302` / ADR 0108 Amendment 4 items 4–5 — one segment of the Control Room
 * Trends & Energy tab:
 * `GET /control-room/sites/:locationId/segment-views?segment=&point=&range=&from=&to=&compare=`.
 *
 * **Order of refusals** (item 4): `TrendPointsService.forSite` first — the
 * "can read the site" rule and its 404, before any statement of this service;
 * then an unknown or inactive `segment`, or a `point` not in that segment's
 * effective list, is a 404; then a cross-field range fault is
 * `resolveEnergyRange`'s 400; then the scope; then the two telemetry
 * statements.
 *
 * **Access before read.** `telemetry.*` has no RLS, so the asset list is the
 * isolation control. The site's rows are read as `bms_fleet` with the site
 * bound, then intersected with `readableAssetIds` here; a global admin
 * (`null`) resolves to that explicit list, never to "no filter". No candidate
 * answers the empty view with no telemetry statement.
 *
 * **Exactly two telemetry statements per request, compare or not**: A
 * (windows) for the ranking and the abnormal list, B (series) for the top
 * assets of the ranking. The segments come from the same rows, so the sub-tab
 * nav needs no second read, and nothing here names a segment (§5.2).
 *
 * The dependencies are plain class types (no `Pick<…>`, no
 * `@Inject(AccessControlService)`), which is what the wiring spec's source
 * scan reads.
 */
@Injectable()
export class SiteSegmentViewsService {
  constructor(
    @Inject(FLEET_POOL) private readonly pool: Pool,
    private readonly accessControl: AccessControlService,
    private readonly trendPoints: TrendPointsService,
  ) {}

  async forSite(
    jwt: JwtPayload,
    locationId: string,
    query: SiteSegmentViewsQuery,
    now: Date = new Date(),
  ): Promise<SiteSegmentViewsDto> {
    return this.readFrame(await this.frameFor(jwt, locationId, query, now));
  }

  /**
   * `F4.303` U4 (ADR 0108 Amendment 6 item 3; plan C4) — the export's rows:
   * `frameFor` (every refusal), then the cap over the frame's arithmetic, then
   * `readFrame` — the read the screen runs — so the cap sits between the
   * guards and the first telemetry statement. Only the drawn series are in the
   * file. `cap` is a seam for the specs; the routes pass nothing.
   */
  async exportRows(
    jwt: JwtPayload,
    locationId: string,
    query: SiteSegmentViewsQuery,
    now: Date = new Date(),
    cap: number = MAX_EXPORT_ROWS,
  ): Promise<ViewExportRow[]> {
    const resolved = await this.frameFor(jwt, locationId, query, now);
    assertViewExportWithinCap(segmentViewExportRowCount(resolved.frame), cap);
    return segmentViewExportRows(await this.readFrame(resolved));
  }

  async exportCsv(jwt: JwtPayload, locationId: string, query: SiteSegmentViewsQuery): Promise<string> {
    return viewExportCsv(await this.exportRows(jwt, locationId, query));
  }

  async exportXlsx(jwt: JwtPayload, locationId: string, query: SiteSegmentViewsQuery): Promise<Buffer> {
    return viewExportXlsx(await this.exportRows(jwt, locationId, query));
  }

  /**
   * Everything before the first telemetry statement: the site's 404, the
   * segment and point 404s, the zone, the range frame (its 400s), the scope
   * and the candidates. No `telemetry.*` statement runs here.
   */
  async frameFor(
    jwt: JwtPayload,
    locationId: string,
    query: SiteSegmentViewsQuery,
    now: Date,
  ): Promise<SegmentViewsReadFrame> {
    const site = await this.trendPoints.forSite(jwt, locationId);
    // An asked segment or point is checked against the organization's list before any scope read.
    if (query.segment !== undefined) {
      pickPoint(pickSegment(site.segments, [], query.segment), query.point);
    }

    const zone = await siteTimeZone(this.pool, locationId);
    const frame = segmentFrame(query, zone, now);

    const readable = await this.accessControl.readableAssetIds(jwt);
    const rows = readable !== null && readable.length === 0 ? [] : await siteAssetRows(this.pool, locationId, null);
    const readableSet = readable === null ? null : new Set(readable);
    const inScope = readableSet === null ? rows : rows.filter((row) => readableSet.has(row.asset_id));

    const segments = segmentsPresent(site.segments, inScope);
    const segment = pickSegment(site.segments, segments, query.segment);
    const point = pickPoint(segment, query.point);
    const candidates = segment && point ? candidatesFor(inScope, segment.domain, point.code) : [];
    return { locationId, now, zone, frame, segments, segment, point, candidates };
  }

  /** The two telemetry statements (A windows, B series) over a resolved frame, and the DTO. */
  async readFrame(resolved: SegmentViewsReadFrame): Promise<SiteSegmentViewsDto> {
    const { locationId, now, zone, frame, segments, segment, point, candidates } = resolved;
    const windowRows =
      candidates.length === 0 || point === null
        ? []
        : await segmentWindowReads(this.pool, {
            level: frame.level,
            pointKey: point.code,
            assetIds: candidates.map((asset) => asset.assetId),
            windows: readWindows(frame),
          });
    const ranking = rankingOf(candidates, windowRows);
    const series =
      ranking.seriesIds.length === 0 || point === null
        ? []
        : await segmentSeriesRead(this.pool, {
            level: frame.level,
            bucket: frame.bucket,
            timeZone: zone.arithmeticZone,
            pointKey: point.code,
            assetIds: ranking.seriesIds,
            current: frame.current,
            compare: frame.previous,
          });
    const abnormal = orderAndTrimSegment(segmentAbnormalEntries(candidates, windowRows), ABNORMAL_LIST_MAX);

    const drawn = new Set(ranking.seriesIds);
    const seriesOf = (assetId: string, idx: 0 | -1, period: EnergyViewPeriodRange | null) =>
      period === null
        ? null
        : fillSeries(
            series.filter((row: SegmentSeriesRow) => row.assetId === assetId && row.idx === idx),
            period,
            frame.level,
            frame.bucket,
            zone,
          );
    const rankingDto: SegmentViewRankingEntryDto[] = ranking.ranked.map((asset) => ({
      assetId: asset.assetId,
      assetCode: asset.assetCode,
      assetName: asset.assetName,
      assetRtuName: asset.assetRtuName,
      assetLocationName: asset.assetLocationName,
      unit: asset.unit,
      current: asset.current,
      compare: asset.compare,
      buckets: drawn.has(asset.assetId) ? seriesOf(asset.assetId, 0, frame.current) : null,
      compareBuckets: drawn.has(asset.assetId) ? seriesOf(asset.assetId, -1, frame.previous) : null,
    }));

    return {
      locationId,
      timeZone: zone.timeZone,
      generatedAt: now.toISOString(),
      level: frame.level,
      bucket: frame.bucket,
      current: bounds(frame.current),
      compare: frame.previous === null ? null : bounds(frame.previous),
      segments,
      segment: segment === null ? null : { domain: segment.domain, label: segment.label, source: segment.source },
      points: (segment?.points ?? []).map((p) => ({ code: p.code, name: p.name, unit: p.unit })),
      point: point === null ? null : { code: point.code, name: point.name, unit: point.unit },
      ranking: rankingDto,
      moreAssets: ranking.moreAssets,
      seriesCount: ranking.seriesIds.length,
      trimmed: ranking.trimmed,
      abnormal: {
        baseline: {
          windows: BASELINE_WINDOWS,
          windowsConsulted: frame.consulted.length,
          stepDays: frame.stepDays,
          ratio: ABNORMAL_RATIO,
          belowRatio: ABNORMAL_BELOW_RATIO,
          nearZeroFraction: ABNORMAL_NEAR_ZERO_FRACTION,
        },
        entries: abnormal.entries,
        normalCount: abnormal.normalCount,
        truncated: abnormal.truncated,
      },
    };
  }
}
