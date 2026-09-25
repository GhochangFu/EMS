import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";

import type {
  GeneratedSiteAssetDto,
  GeneratedSiteDomainDto,
  GeneratedSitePointDto,
  GeneratedSiteViewDto,
  JwtPayload,
} from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { FLEET_POOL } from "../database/database.tokens";
import { telemetryFreshnessAt } from "../telemetry/telemetry-freshness";

const NOT_FOUND = "Location not found or outside your access scope";

/** Statement (1)'s row: the location, and one of its in-scope assets (or none). */
interface AssetRow {
  asset_id: string | null;
  asset_code: string | null;
  asset_name: string | null;
  domain_code: string | null;
  domain_label: string | null;
}

/** Statement (2)'s row: one active registered point of one asset, with its latest sample. */
interface PointRow {
  asset_id: string;
  point_key: string;
  name: string | null;
  unit: string | null;
  headline_rank: number | null;
  value: number | null;
  time: Date | string | null;
}

/**
 * `F3.68` / ADR 0076 decision 7 — `GET /api/v1/control-room/sites/:locationId/generated`:
 * for a site the caller can read, one panel per asset domain present at the
 * site, one entry per readable asset with its live status and its registered
 * points in headline order, each with its latest value.
 *
 * **Access (plan D7).** `forUser` applies the F3.67 readable rule
 * (`SiteControlRoomViewService.resolve`: a global scope, or the site among
 * the scope's locations) and answers the same 404 otherwise, so an
 * out-of-scope site is indistinguishable from a missing one. The asset scope
 * is the `DashboardController.locationDashboard` input: `null` (no asset
 * filter) for a global scope, else `scope.assetIds`.
 *
 * **The read (plan D4).** Two statements on `FLEET_POOL` whatever the asset
 * count (ADR 0043 Amendment 3: fleet pool, the `WHERE` is the isolation
 * control, every id already authorized):
 *
 * 1. The location, left-joined to its in-scope assets and their domain,
 *    ordered `sort_order, domain code, asset code`. Anchoring on
 *    `bms.locations` keeps F3.67's 404 for an unknown id under a global scope
 *    without a third statement.
 * 2. The active `bms.asset_points` of exactly the asset ids statement (1)
 *    returned — the scope predicate is spelled once, in (1) — left-joined to
 *    the `bms.point_keys` catalog (name, rank, fallback unit) and to each
 *    point's newest sample (`DISTINCT ON (asset_id, point_key)`, the
 *    `locationDashboard.latest_points` shape), ordered by the one rule of plan
 *    D1: `headline_rank ASC NULLS LAST, point_key ASC`.
 *
 * No time predicate on `point_values` (`latest` is "the newest ever", not
 * "the newest within a window"), no `assets.active` filter (parity with the
 * KPI header), nothing read from a template: PHEWB's assets have none.
 *
 * **Freshness (plan D3).** An asset's `latestTelemetryAt` is the newest
 * sample among its registered active points, judged by
 * `telemetryFreshnessAt` at `nowMs`. This can differ from `/locations/:id`'s
 * `freshAssetCount`, which counts a sample of any point.
 *
 * **Rows are mapped by hand (plan D10)** — no `.parse` of stored data.
 */
@Injectable()
export class GeneratedSiteViewService {
  constructor(
    @Inject(FLEET_POOL) private readonly pool: Pool,
    private readonly accessControl: AccessControlService,
  ) {}

  async forUser(jwt: JwtPayload, locationId: string): Promise<GeneratedSiteViewDto> {
    const { scope } = await this.accessControl.currentUser(jwt);
    const readable =
      scope.kind === "global" || scope.locations.some((location) => location.id === locationId);
    if (!readable) {
      throw new NotFoundException(NOT_FOUND);
    }
    const assetIds = scope.kind === "global" ? null : scope.assetIds;
    return this.read(locationId, assetIds, Date.now());
  }

  /**
   * The pool-only half: `assetIds = null` reads every asset at the site;
   * `[]` answers no domains and sends no query.
   */
  async read(locationId: string, assetIds: string[] | null, nowMs: number): Promise<GeneratedSiteViewDto> {
    const asOf = new Date(nowMs).toISOString();
    if (assetIds !== null && assetIds.length === 0) {
      return { locationId, asOf, domains: [] };
    }

    const assets = await this.pool.query<AssetRow>(
      `
      SELECT
        a.id AS asset_id,
        a.code AS asset_code,
        a.name AS asset_name,
        a.domain AS domain_code,
        d.label AS domain_label
      FROM bms.locations l
      LEFT JOIN bms.assets a
        ON a.location_id = l.id
       AND ($2::uuid[] IS NULL OR a.id = ANY($2::uuid[]))
      LEFT JOIN bms.asset_domains d ON d.code = a.domain
      WHERE l.id = $1
      ORDER BY d.sort_order, a.domain, a.code
      `,
      [locationId, assetIds],
    );
    if (assets.rows.length === 0) {
      throw new NotFoundException(NOT_FOUND);
    }

    const ids = assets.rows.flatMap((row) => (row.asset_id === null ? [] : [row.asset_id]));
    if (ids.length === 0) {
      return { locationId, asOf, domains: [] };
    }

    const points = await this.pool.query<PointRow>(
      `
      WITH scoped_assets AS (
        SELECT unnest($1::uuid[]) AS id
      ),
      latest AS (
        SELECT DISTINCT ON (pv.asset_id, pv.point_key)
          pv.asset_id,
          pv.point_key,
          pv.value,
          pv.time
        FROM telemetry.point_values pv
        INNER JOIN scoped_assets sa ON sa.id = pv.asset_id
        ORDER BY pv.asset_id, pv.point_key, pv.time DESC
      )
      SELECT
        ap.asset_id,
        ap.point_key,
        pk.name,
        COALESCE(ap.unit, pk.unit) AS unit,
        pk.headline_rank,
        lt.value,
        lt.time
      FROM scoped_assets sa
      INNER JOIN bms.asset_points ap ON ap.asset_id = sa.id AND ap.active = true
      LEFT JOIN bms.point_keys pk ON pk.code = ap.point_key
      LEFT JOIN latest lt ON lt.asset_id = ap.asset_id AND lt.point_key = ap.point_key
      ORDER BY ap.asset_id, pk.headline_rank ASC NULLS LAST, ap.point_key ASC
      `,
      [ids],
    );

    const pointsByAsset = new Map<string, GeneratedSitePointDto[]>();
    const newestByAsset = new Map<string, string>();
    for (const row of points.rows) {
      const time = toIsoString(row.time);
      const latest = time !== null && row.value !== null ? { value: Number(row.value), time } : null;
      const list = pointsByAsset.get(row.asset_id) ?? [];
      list.push({
        pointKey: row.point_key,
        name: row.name,
        unit: row.unit,
        headlineRank: row.headline_rank === null ? null : Number(row.headline_rank),
        latest,
      });
      pointsByAsset.set(row.asset_id, list);
      const newest = newestByAsset.get(row.asset_id);
      if (latest !== null && (newest === undefined || Date.parse(latest.time) > Date.parse(newest))) {
        newestByAsset.set(row.asset_id, latest.time);
      }
    }

    // Grouped in statement (1)'s order: a `Map` keeps insertion order, and
    // nothing here re-sorts, so the SQL `ORDER BY` alone decides the panels.
    const domains = new Map<string, GeneratedSiteDomainDto>();
    for (const row of assets.rows) {
      if (row.asset_id === null) continue;
      const code = row.domain_code ?? "";
      let domain = domains.get(code);
      if (!domain) {
        domain = { code, label: row.domain_label ?? code, assets: [] };
        domains.set(code, domain);
      }
      const latestTelemetryAt = newestByAsset.get(row.asset_id) ?? null;
      const asset: GeneratedSiteAssetDto = {
        id: row.asset_id,
        code: row.asset_code ?? "",
        name: row.asset_name ?? "",
        domain: code,
        latestTelemetryAt,
        freshness: telemetryFreshnessAt(latestTelemetryAt, nowMs),
        points: pointsByAsset.get(row.asset_id) ?? [],
      };
      domain.assets.push(asset);
    }

    return { locationId, asOf, domains: [...domains.values()] };
  }
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
