import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";

import {
  type JwtPayload,
  type SiteTrendStripDto,
  type SiteTrendStripQuery,
  TREND_STRIP_MAX_SERIES,
  resolveSiteTimeZone,
} from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { FLEET_POOL } from "../database/database.tokens";
import { TrendPointsService } from "./trend-points.service";
import { trendStripRead } from "./trend-strip-read";
import {
  type StripAsset,
  type StripRegistration,
  fitSeries,
  groupSeries,
  pairsFor,
  planPairs,
  stripWindow,
} from "./trend-strip.pure";

export const TREND_STRIP_GROUP_NOT_FOUND = "Asset group not found at this site";

type AssetRow = {
  asset_id: string;
  asset_code: string;
  asset_name: string;
  domain: string;
  point_key: string;
  unit: string | null;
};

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
    const timeZone = await this.zone(locationId);
    const rows = readable !== null && readable.length === 0 ? [] : await this.scopeRows(locationId, assetGroupId);
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
      range: query.range,
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

  /** The location → organization → `UTC` chain (Amendment 2 item 8); a stored `UTC` reports `UTC`. */
  private async zone(locationId: string): Promise<string> {
    const { rows } = await this.pool.query<{ location_zone: string | null; organization_zone: string | null }>(
      `SELECT l.timezone AS location_zone, o.timezone AS organization_zone
         FROM bms.locations l
         JOIN bms.organizations o ON o.id = l.organization_id
        WHERE l.id = $1::uuid`,
      [locationId],
    );
    const row = rows[0];
    return resolveSiteTimeZone(row?.location_zone ?? null, row?.organization_zone ?? null).timeZone;
  }

  /**
   * The site's assets — narrowed to the group's members (`asset_group_members`,
   * the group pinned to this site) when one is named — joined to their active
   * registrations, with the effective unit. One statement, site and group bound.
   */
  private async scopeRows(locationId: string, assetGroupId: string | null): Promise<AssetRow[]> {
    const groupFilter =
      assetGroupId === null
        ? ""
        : `AND a.id IN (
             SELECT m.asset_id
               FROM bms.asset_group_members m
               JOIN bms.asset_groups g ON g.id = m.asset_group_id AND g.location_id = $1::uuid
              WHERE m.asset_group_id = $2::uuid
           )`;
    const { rows } = await this.pool.query<AssetRow>(
      `SELECT a.id AS asset_id, a.code AS asset_code, a.name AS asset_name, a.domain,
              ap.point_key, COALESCE(ap.unit, pk.unit) AS unit
         FROM bms.assets a
         JOIN bms.asset_points ap ON ap.asset_id = a.id AND ap.active = true
         LEFT JOIN bms.point_keys pk ON pk.code = ap.point_key
        WHERE a.location_id = $1::uuid
          ${groupFilter}
        ORDER BY a.code, ap.point_key`,
      assetGroupId === null ? [locationId] : [locationId, assetGroupId],
    );
    return rows;
  }
}
