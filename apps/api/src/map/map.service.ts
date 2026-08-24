import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

import type { MapSiteDto, MapSiteLive } from "@bms/shared";

import { FLEET_POOL } from "../database/database.tokens";

type LocRow = {
  id: string;
  canonical_location_id: string | null;
  slug: string;
  name: string;
  kind: string;
  site_name: string | null;
  org_id: string | null;
  org_code: string | null;
  org_name: string | null;
  latitude: string;
  longitude: string;
  capacity_mw: string | null;
  station_type: string | null;
  station_category: string | null;
  province: string | null;
  station_operating_status: string | null;
};

function isOperationalLocation(kind: string): boolean {
  return kind === "smoc_campus" || kind === "rsmoc" || kind === "csmoc";
}

/**
 * `F4.16` / ADR 0043 — read-only, and its `LEFT JOIN bms.locations` (RLS since
 * migration `0040`) means this pool must be `fleetPool` — `map_locations`
 * itself carries no organization column to filter on, so a tenant connection
 * could not serve this query even scoped.
 */
@Injectable()
export class MapService {
  constructor(@Inject(FLEET_POOL) private readonly pool: Pool) {}

  /** All visible map locations with per-site live health derived from alarms + telemetry freshness. */
  async sitesLive(opts?: {
    allowedSiteNames?: string[] | null;
    assetIds?: string[] | null;
  }): Promise<MapSiteDto[]> {
    const locs = await this.pool.query<LocRow>(
      `SELECT ml.id,
              l.id AS canonical_location_id,
              ml.slug,
              ml.name,
              ml.kind,
              ml.site_name,
              o.id AS org_id,
              o.code AS org_code,
              o.name AS org_name,
              ml.latitude,
              ml.longitude,
              ml.capacity_mw,
              ml.station_type,
              ml.station_category,
              ml.province,
              ml.station_operating_status
       FROM bms.map_locations ml
       LEFT JOIN bms.locations l ON l.slug = ml.slug
       LEFT JOIN bms.organizations o ON o.id = l.organization_id
       ORDER BY ml.kind DESC, ml.name ASC`,
    );

    const assetIds = opts?.assetIds ?? null;
    const alarmRows = await this.pool.query<{
      location_id: string;
      open_alarms: string;
      critical_alarms: string;
    }>(
      `SELECT a.location_id,
              COUNT(*) FILTER (WHERE al.acknowledged_at IS NULL)::int AS open_alarms,
              COUNT(*) FILTER (WHERE al.acknowledged_at IS NULL AND al.severity = 'critical')::int AS critical_alarms
       FROM bms.alarms al
       INNER JOIN bms.assets a ON a.id = al.asset_id
       WHERE a.location_id IS NOT NULL
         AND ($1::uuid[] IS NULL OR a.id = ANY($1::uuid[]))
       GROUP BY a.location_id`,
      [assetIds],
    );
    const alarmMap = new Map(
      alarmRows.rows.map((r) => [
        r.location_id,
        {
          open: Number(r.open_alarms),
          critical: Number(r.critical_alarms),
        },
      ]),
    );

    const commRows = await this.pool.query<{
      location_id: string;
      asset_count: string;
      fresh_count: string;
    }>(
      `WITH latest AS (
         SELECT DISTINCT ON (asset_id) asset_id, time AS kw_time
         FROM telemetry.point_values
         WHERE point_key = 'kw'
         ORDER BY asset_id, time DESC
       )
       SELECT a.location_id,
              COUNT(a.id)::int AS asset_count,
              COUNT(l.asset_id) FILTER (WHERE l.kw_time > now() - interval '25 seconds')::int AS fresh_count
       FROM bms.assets a
       LEFT JOIN latest l ON l.asset_id = a.id
       WHERE a.location_id IS NOT NULL
         AND ($1::uuid[] IS NULL OR a.id = ANY($1::uuid[]))
       GROUP BY a.location_id`,
      [assetIds],
    );
    const commMap = new Map(
      commRows.rows.map((r) => [
        r.location_id,
        {
          total: Number(r.asset_count),
          fresh: Number(r.fresh_count),
        },
      ]),
    );

    const allowedSiteNames = opts?.allowedSiteNames;
    const visibleLocs =
      allowedSiteNames === null || allowedSiteNames === undefined
        ? locs.rows
        : locs.rows.filter(
            (loc) => loc.site_name && allowedSiteNames.includes(loc.site_name),
          );

    return visibleLocs.map((loc) => {
      const organization =
        loc.org_id && loc.org_code && loc.org_name
          ? { id: loc.org_id, code: loc.org_code, name: loc.org_name }
          : null;
      const base = {
        id: loc.id,
        canonicalLocationId: loc.canonical_location_id,
        slug: loc.slug,
        name: loc.name,
        kind: loc.kind as MapSiteDto["kind"],
        siteName: loc.site_name,
        organization,
        latitude: Number(loc.latitude),
        longitude: Number(loc.longitude),
        capacityMw: loc.capacity_mw ? Number(loc.capacity_mw) : null,
        stationType: loc.station_type,
        stationCategory: loc.station_category,
        province: loc.province,
        stationOperatingStatus: loc.station_operating_status,
      };

      if (isOperationalLocation(loc.kind) && loc.canonical_location_id) {
        const a = alarmMap.get(loc.canonical_location_id) ?? { open: 0, critical: 0 };
        const c = commMap.get(loc.canonical_location_id) ?? { total: 0, fresh: 0 };
        const live = this.campusLive(a, c);
        return { ...base, live };
      }

      const live = this.stationLive(loc.station_operating_status);
      return { ...base, live };
    });
  }

  private campusLive(
    a: { open: number; critical: number },
    c: { total: number; fresh: number },
  ): MapSiteLive {
    const ratio = c.total === 0 ? 1 : c.fresh / c.total;
    let status: MapSiteLive["status"] = "healthy";
    if (c.total === 0) {
      status = "unknown";
    } else if (a.critical > 0) {
      status = "critical";
    } else if (a.open > 0) {
      status = "warning";
    } else if (ratio < 1) {
      status = "offline";
    }
    return {
      status,
      openAlarms: a.open,
      criticalAlarms: a.critical,
      assetsTotal: c.total,
      assetsFresh: c.fresh,
    };
  }

  private stationLive(op: string | null): MapSiteLive {
    const nominal = op === "op";
    return {
      status: nominal ? "nominal" : "unknown",
      openAlarms: 0,
      criticalAlarms: 0,
      assetsTotal: 0,
      assetsFresh: 0,
    };
  }
}
