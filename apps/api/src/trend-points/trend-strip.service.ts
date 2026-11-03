import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";

import {
  type JwtPayload,
  type SiteTrendStripDto,
  type SiteTrendStripQuery,
  TREND_STRIP_MAX_SERIES,
} from "@bms/shared";

import { MAX_EXPORT_ROWS } from "../admin/audit/audit.limits";
import { AccessControlService } from "../auth/access-control.service";
import { FLEET_POOL } from "../database/database.tokens";
import {
  type ViewExportRow,
  assertViewExportWithinCap,
  trendStripExportRows,
  viewExportCsv,
  viewExportXlsx,
} from "../reports/view-export.serialise";
import { siteAssetRows, siteTimeZone } from "./site-asset-rows";
import { TrendPointsService } from "./trend-points.service";
import { trendStripRead } from "./trend-strip-read";
import {
  type StripAsset,
  type StripPlan,
  type StripRegistration,
  type StripWindow,
  fitSeries,
  groupSeries,
  pairsFor,
  planPairs,
  stripWindow,
} from "./trend-strip.pure";

export const TREND_STRIP_GROUP_NOT_FOUND = "Asset group not found at this site";

/**
 * `F4.303` U4 — what `frameFor` resolves before the telemetry statement: the
 * window, the zone, the series plan and its (asset, point) pairs.
 */
export type TrendStripReadFrame = {
  readonly locationId: string;
  readonly assetGroupId: string | null;
  readonly range: SiteTrendStripQuery["range"];
  readonly window: StripWindow;
  readonly timeZone: string;
  readonly plan: StripPlan;
  readonly pairs: { assetId: string; pointKey: string }[];
};

/**
 * `F4.303` U4 (ADR 0108 Amendment 6 item 3; plan C4) — the rows the strip
 * export can hold, before the telemetry statement: one per planned pair per
 * window bucket.
 */
export function trendStripExportRowCount(
  pairs: readonly unknown[],
  window: Pick<StripWindow, "buckets">,
): number {
  return pairs.length * window.buckets;
}

/**
 * `F4.301` / ADR 0108 Amendment 2 — the Control Room trend strip for one site
 * tab: `GET /control-room/sites/:locationId/trend-strip?range=&assetGroupId=`.
 *
 * **Order of refusals** (item 3): `TrendPointsService.forSite` first — the
 * "can read the site" rule and its 404, before any statement of this service;
 * then a group not at the site is a 404; then the scope; then one telemetry
 * statement.
 *
 * **Access before read** (item 4): `telemetry.*` has no RLS, so the pair
 * arrays are the isolation control. The site's (or the group's) assets are
 * read as `bms_fleet` with the site and the group bound in the `WHERE`, then
 * intersected with `readableAssetIds` here; a global admin (`null`) resolves
 * to that explicit list, never to "no filter". An empty scope answers
 * `segments: []` before the telemetry statement.
 *
 * **Tab → segments** (item 1) is the distinct `assets.domain` of the assets in
 * scope, in `forSite`'s order; a segment is data, so nothing here names one.
 * The dependencies are plain class types (no `Pick<…>`, no
 * `@Inject(AccessControlService)`), which is what the wiring spec's source
 * scan reads.
 */
@Injectable()
export class SiteTrendStripService {
  constructor(
    @Inject(FLEET_POOL) private readonly pool: Pool,
    private readonly accessControl: AccessControlService,
    private readonly trendPoints: TrendPointsService,
  ) {}

  async forSite(
    jwt: JwtPayload,
    locationId: string,
    query: SiteTrendStripQuery,
    now: Date = new Date(),
  ): Promise<SiteTrendStripDto> {
    return this.readFrame(await this.frameFor(jwt, locationId, query, now));
  }

  /**
   * `F4.303` U4 (ADR 0108 Amendment 6 item 3; plan C4) — the export's rows:
   * `frameFor` (every refusal and the planned pairs), then the cap over
   * pairs × buckets, then `readFrame` — the read the strip runs — so the cap
   * sits between the guards and the one telemetry statement. `cap` is a seam
   * for the specs; the routes pass nothing.
   */
  async exportRows(
    jwt: JwtPayload,
    locationId: string,
    query: SiteTrendStripQuery,
    now: Date = new Date(),
    cap: number = MAX_EXPORT_ROWS,
  ): Promise<ViewExportRow[]> {
    const resolved = await this.frameFor(jwt, locationId, query, now);
    assertViewExportWithinCap(trendStripExportRowCount(resolved.pairs, resolved.window), cap);
    return trendStripExportRows(await this.readFrame(resolved));
  }

  async exportCsv(jwt: JwtPayload, locationId: string, query: SiteTrendStripQuery): Promise<string> {
    return viewExportCsv(await this.exportRows(jwt, locationId, query));
  }

  async exportXlsx(jwt: JwtPayload, locationId: string, query: SiteTrendStripQuery): Promise<Buffer> {
    return viewExportXlsx(await this.exportRows(jwt, locationId, query));
  }

  /**
   * Everything before the telemetry statement: the site's 404, the group's
   * 404, the window, the scope, the zone and the planned pairs. No
   * `telemetry.*` statement runs here.
   */
  async frameFor(
    jwt: JwtPayload,
    locationId: string,
    query: SiteTrendStripQuery,
    now: Date,
  ): Promise<TrendStripReadFrame> {
    const site = await this.trendPoints.forSite(jwt, locationId);
    const assetGroupId = query.assetGroupId ?? null;
    if (assetGroupId !== null) {
      const group = await this.pool.query(
        `SELECT 1 AS ok FROM bms.asset_groups WHERE id = $1::uuid AND location_id = $2::uuid`,
        [assetGroupId, locationId],
      );
      if (group.rows.length === 0) {
        throw new NotFoundException(TREND_STRIP_GROUP_NOT_FOUND);
      }
    }

    const window = stripWindow(query.range, now);
    const readable = await this.accessControl.readableAssetIds(jwt);
    const timeZone = (await siteTimeZone(this.pool, locationId)).timeZone;
    const rows =
      readable !== null && readable.length === 0 ? [] : await siteAssetRows(this.pool, locationId, assetGroupId);
    const readableSet = readable === null ? null : new Set(readable);
    const inScope = readableSet === null ? rows : rows.filter((row) => readableSet.has(row.asset_id));

    const assets = new Map<string, StripAsset>();
    const registrations: StripRegistration[] = [];
    for (const row of inScope) {
      if (!assets.has(row.asset_id)) {
        assets.set(row.asset_id, { id: row.asset_id, code: row.asset_code, name: row.asset_name, domain: row.domain });
      }
      registrations.push({ assetId: row.asset_id, pointKey: row.point_key, unit: row.unit });
    }

    const plan = fitSeries(
      pairsFor([...assets.values()], site.segments, registrations, { overview: assetGroupId === null }),
      TREND_STRIP_MAX_SERIES,
    );
    const pairs = planPairs(plan);
    return { locationId, assetGroupId, range: query.range, window, timeZone, plan, pairs };
  }

  /** The one telemetry statement over a resolved frame, and the DTO. */
  async readFrame(resolved: TrendStripReadFrame): Promise<SiteTrendStripDto> {
    const { locationId, assetGroupId, range, window, timeZone, plan, pairs } = resolved;
    const series =
      pairs.length === 0
        ? []
        : await trendStripRead(this.pool, {
            level: window.level,
            bucketSeconds: window.bucketSeconds,
            from: window.from,
            to: window.to,
            pairs,
          });

    return {
      locationId,
      assetGroupId,
      range,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      level: window.level,
      bucketSeconds: window.bucketSeconds,
      timeZone,
      assetsPerPoint: plan.assetsPerPoint,
      pointsPerSegment: plan.pointsPerSegment,
      trimmed: plan.trimmed,
      segments: groupSeries(plan, series, window),
    };
  }
}
