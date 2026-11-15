import type { Pool } from "pg";

import { ENERGY_DATA_WINDOW_DAYS, isEnergyShown } from "./energy-features";

/**
 * `F4.375` (ADR 0133 Amendment 2 ruling 1, plan U3) — the estate ribbon's energy summary: which
 * locations in the caller's scope show energy, and the summed latest `kw` over them.
 *
 * **Card parity (plan D3).** The population is the location cards' own: in-scope assets at
 * **active** locations, the same 30-day `kw` window and the same organization setting, decided
 * by the same rule (`isEnergyShown`). So `totalKw` equals the sum of the non-null `totalKw` of
 * `DashboardService.locationKpis` for the same scope (before the cards' 2-decimal rounding), and
 * `energyShown` equals "some card shows energy" — for every location that holds an in-scope asset.
 */

/** One active location of the in-scope assets, as the SQL reads it. */
export interface EstateEnergyLocationRow {
  locationId: string;
  /** `bms.organizations.energy_features` as stored; an unknown value reads as `auto`. */
  energyFeatures: unknown;
  /** An active in-scope asset has a `kw` value inside `ENERGY_DATA_WINDOW_DAYS`. */
  hasEnergyData: boolean;
  /** The summed latest `kw` of the location's in-scope assets, or `null` when none has a value. */
  totalKw: number | null;
}

/** What the ribbon needs: the flag, the total and the shown locations (for the prior, plan D4). */
export interface EstateEnergy {
  energyShown: boolean;
  /** `null` when nothing is shown, and `null` (never `0`) when no shown location has a value. */
  totalKw: number | null;
  shownLocationIds: string[];
}

/** The pure half: per-location facts in, the ribbon's summary out. */
export function summariseEstateEnergy(rows: readonly EstateEnergyLocationRow[]): EstateEnergy {
  const shown = rows.filter((row) => isEnergyShown(row.energyFeatures, row.hasEnergyData));
  const values = shown.map((row) => row.totalKw).filter((kw): kw is number => kw !== null);
  return {
    energyShown: shown.length > 0,
    totalKw: values.length === 0 ? null : values.reduce((sum, kw) => sum + kw, 0),
    shownLocationIds: shown.map((row) => row.locationId),
  };
}

/**
 * One statement: the newest `kw` per in-scope asset (`kw_latest`, moved here from `kpis()`), then
 * per **active** location of the in-scope assets its sum, whether an active asset's newest `kw`
 * is inside the window, and the organization's stored setting. Locations come from the assets
 * `LEFT JOIN kw_latest`, so an `on` location with no meter still has a row (shown, `null`).
 *
 * `pool` is `DashboardService`'s `FLEET_POOL` (BYPASSRLS, ADR 0043): the `$1::uuid[]` asset scope
 * is the only isolation control, applied to both the telemetry read and the asset join, exactly
 * as the live reads it replaces. `$1` `null` is every asset (a global caller); an empty list
 * answers without a query.
 */
export async function readEstateEnergy(pool: Pick<Pool, "query">, assetIds: string[] | null): Promise<EstateEnergy> {
  if (assetIds && assetIds.length === 0) {
    return { energyShown: false, totalKw: null, shownLocationIds: [] };
  }
  const r = await pool.query<{
    location_id: string;
    total_kw: number | null;
    has_energy_data: boolean;
    energy_features: string;
  }>(
    `
    WITH kw_latest AS (
      SELECT DISTINCT ON (asset_id) asset_id, time AS kw_time, value AS kw
      FROM telemetry.point_values
      WHERE point_key = 'kw' AND ($1::uuid[] IS NULL OR asset_id = ANY($1::uuid[]))
      ORDER BY asset_id, time DESC
    )
    -- F4.159: no foreign key holds telemetry to bms.assets; only existing assets count (the join).
    -- F4.375 (plan D3): only active locations, as the cards' l.active = true.
    SELECT
      a.location_id,
      SUM(k.kw)::float8 AS total_kw,
      COALESCE(bool_or(a.active AND k.kw_time >= now() - make_interval(days => $2::int)), false) AS has_energy_data,
      o.energy_features
    FROM bms.assets a
    INNER JOIN bms.locations l ON l.id = a.location_id AND l.active
    INNER JOIN bms.organizations o ON o.id = l.organization_id
    LEFT JOIN kw_latest k ON k.asset_id = a.id
    WHERE ($1::uuid[] IS NULL OR a.id = ANY($1::uuid[]))
    GROUP BY a.location_id, o.energy_features
    `,
    [assetIds ?? null, ENERGY_DATA_WINDOW_DAYS],
  );
  return summariseEstateEnergy(
    r.rows.map((row) => ({
      locationId: row.location_id,
      energyFeatures: row.energy_features,
      hasEnergyData: row.has_energy_data,
      totalKw: row.total_kw === null ? null : Number(row.total_kw),
    })),
  );
}
