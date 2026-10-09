import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

import type { BmsDb } from "@bms/db";
import type { MapSiteDto, MapSiteLive } from "@bms/shared";

import { expandLocationSubtrees } from "../auth/location-tree";
import { FLEET_DRIZZLE, FLEET_POOL } from "../database/database.tokens";
import { LIVE_ASSETS_CTE_SQL } from "../telemetry/telemetry-freshness";

/**
 * `F2.10` / ADR 0098 decision 11 — a location is a pin when it has no active child node or holds
 * an active asset. Correlated on the alias `l` (`bms.locations`) of whichever arm embeds it.
 */
const PIN_RULE = `(NOT EXISTS (SELECT 1 FROM bms.locations c WHERE c.parent_id = l.id AND c.organization_id = l.organization_id AND c.active) OR EXISTS (SELECT 1 FROM bms.assets a WHERE a.location_id = l.id AND a.active))`;

type LocRow = {
  id: string;
  canonical_location_id: string | null;
  slug: string;
  name: string;
  kind: string;
  location_type: string | null;
  location_type_label: string | null;
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

/**
 * `F4.16` / ADR 0043 — read-only, and its `LEFT JOIN bms.locations` (RLS since
 * migration `0040`) means this pool must be `fleetPool` — `map_locations`
 * itself carries no organization column to filter on, so a tenant connection
 * could not serve this query even scoped.
 *
 * `F4.157` / ADR 0077 — a pin that joins a location takes its `kind` from
 * `bms.locations.type` and its `kindLabel` from `bms.location_types.label`
 * (`bms_fleet` holds SELECT on the lookup, migration `0085`), and carries
 * live health because it joins a location. A pin that joins none keeps
 * `map_locations.kind` (`eskom_station`) and its operating status.
 *
 * `F3.79` — only the seed writes `map_locations`, so an active location that
 * no pin joins (one an admin or the onboarding agent created) is a pin of its
 * own, built from its own columns: its id is the location id, its `siteName`
 * is the location name, and it carries campus live health like any joined pin.
 * A scoped caller sees a joined pin by its location id, never by its name.
 *
 * `F2.10` / ADR 0098 decision 11 (Drafter choices 11 and 15) — a location is
 * a pin when it has no active child node **or** holds an active asset; an
 * interior node with no asset of its own is only a filter. `PIN_RULE` applies
 * on both arms: a `map_locations` row that joins such a node is dropped too,
 * while a row that joins no location (a reference station) is untouched by
 * the rule. A parent is a filter: `parentLocationId` keeps only the pins whose
 * location is in that node's subtree and drops every unjoined pin (B4). `/map`
 * and the Control Room organization map are this one query (B12).
 */
@Injectable()
export class MapService {
  constructor(
    @Inject(FLEET_POOL) private readonly pool: Pool,
    /** The tree walk's executor (`expandLocationSubtrees`): the same fleet database as `pool`. */
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
  ) {}

  /** All visible map locations with per-site live health derived from alarms + telemetry freshness. */
  async sitesLive(opts?: {
    /** A scoped caller's location names: matched only against a pin that joins no location. */
    allowedSiteNames?: string[] | null;
    /** A scoped caller's location ids: matched against a pin that joins a location. */
    allowedLocationIds?: string[] | null;
    assetIds?: string[] | null;
    /**
     * `F2.10`: keep only pins whose location is in this node's subtree; unjoined pins are dropped
     * (B4). A scoped caller whose readable set does not hold the node gets `[]`, never a 403.
     */
    parentLocationId?: string | null;
  }): Promise<MapSiteDto[]> {
    const locs = await this.pool.query<LocRow>(
      `SELECT ml.id,
              l.id AS canonical_location_id,
              ml.slug,
              ml.name,
              ml.kind,
              l.type AS location_type,
              lt.label AS location_type_label,
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
       LEFT JOIN bms.location_types lt ON lt.code = l.type
       LEFT JOIN bms.organizations o ON o.id = l.organization_id
       WHERE (l.id IS NULL OR ${PIN_RULE})
       UNION ALL
       -- F3.79: an active location that no map_locations row joins is a pin of its own.
       SELECT l.id,
              l.id AS canonical_location_id,
              l.slug,
              l.name,
              l.type AS kind,
              l.type AS location_type,
              lt.label AS location_type_label,
              l.name AS site_name,
              o.id AS org_id,
              o.code AS org_code,
              o.name AS org_name,
              l.latitude,
              l.longitude,
              NULL AS capacity_mw,
              NULL AS station_type,
              NULL AS station_category,
              l.province,
              NULL AS station_operating_status
       FROM bms.locations l
       LEFT JOIN bms.location_types lt ON lt.code = l.type
       LEFT JOIN bms.organizations o ON o.id = l.organization_id
       WHERE l.active
         AND NOT EXISTS (SELECT 1 FROM bms.map_locations ml WHERE ml.slug = l.slug)
         AND ${PIN_RULE}
       ORDER BY kind DESC, name ASC`,
    );

    const assetIds = opts?.assetIds ?? null;
    const alarmRows = await this.pool.query<{
      location_id: string;
      open_alarms: string;
      critical_alarms: string;
    }>(
      `SELECT a.location_id,
              -- ADR 0057 decision 1: open/active = cleared_at IS NULL (since migration 0066).
              -- An acknowledged alarm is still active; acknowledgement only annotates it.
              COUNT(*) FILTER (WHERE al.cleared_at IS NULL)::int AS open_alarms,
              COUNT(*) FILTER (WHERE al.cleared_at IS NULL AND al.severity = 'critical')::int AS critical_alarms
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
      `WITH ${LIVE_ASSETS_CTE_SQL}
       SELECT a.location_id,
              COUNT(a.id)::int AS asset_count,
              COUNT(l.asset_id)::int AS fresh_count
       FROM bms.assets a
       LEFT JOIN live l ON l.asset_id = a.id
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

    // F3.79 security review: a pin that joins a location is scoped by that location's id.
    // Location names are tenant free text and not unique, so a name match would show another
    // organization's same-named location. Only a pin that joins none is matched by `site_name`.
    // Either list set means a scoped caller, and a missing list then matches nothing.
    const allowedSiteNames = opts?.allowedSiteNames ?? null;
    const allowedLocationIds = opts?.allowedLocationIds ?? null;
    const scoped = allowedSiteNames !== null || allowedLocationIds !== null;
    const scopedLocs = scoped
      ? locs.rows.filter((loc) =>
          loc.canonical_location_id !== null
            ? (allowedLocationIds?.includes(loc.canonical_location_id) ?? false)
            : loc.site_name !== null && (allowedSiteNames?.includes(loc.site_name) ?? false),
        )
      : locs.rows;

    // F2.10 (B4, B12): a parent is a filter over the scope above, never a widening. A scoped
    // caller whose readable set lacks the parent gets nothing — intersecting alone would answer
    // an unreadable ancestor of a readable node with that node's pins, confirming a parent link
    // `/auth/me` hides. Unjoined pins have no location in any subtree, so they are dropped.
    const parentLocationId = opts?.parentLocationId ?? null;
    let visibleLocs = scopedLocs;
    if (parentLocationId !== null) {
      if (scoped && !(allowedLocationIds?.includes(parentLocationId) ?? false)) {
        return [];
      }
      const subtree = new Set(await expandLocationSubtrees(this.fleetDb, [parentLocationId]));
      visibleLocs = scopedLocs.filter(
        (loc) => loc.canonical_location_id !== null && subtree.has(loc.canonical_location_id),
      );
    }

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
        kind: loc.location_type ?? loc.kind,
        kindLabel:
          loc.location_type_label ?? (loc.kind === "eskom_station" ? "Station" : loc.kind),
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

      if (loc.canonical_location_id !== null) {
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
