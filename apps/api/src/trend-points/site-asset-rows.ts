import type { Pool } from "pg";

import { type ResolvedSiteTimeZone, resolveSiteTimeZone } from "@bms/shared";

/**
 * `F4.302` U2 (ADR 0108 Amendment 4 item 4) — the site's asset × registration
 * rows and the site's zone, moved from `SiteTrendStripService` so the trend
 * strip and the segment view read one join, never two copies of it
 * (Amendment 2 item 2's series rule).
 *
 * Both run on the fleet pool (BYPASSRLS) with the site bound in the `WHERE`;
 * the caller intersects the rows with `readableAssetIds` before any telemetry
 * read, so this read is the site bound and the intersection is the caller's.
 */

type Queryable = Pick<Pool, "query">;

/** One active registration of one asset at the site, with the effective unit. */
export type SiteAssetRow = {
  asset_id: string;
  asset_code: string;
  asset_name: string;
  domain: string;
  point_key: string;
  unit: string | null;
};

/**
 * The site's assets — narrowed to the group's members (`asset_group_members`,
 * the group pinned to this site) when one is named — joined to their active
 * registrations, with the effective unit. One statement, site and group bound.
 */
export async function siteAssetRows(
  pool: Queryable,
  locationId: string,
  assetGroupId: string | null,
): Promise<SiteAssetRow[]> {
  const groupFilter =
    assetGroupId === null
      ? ""
      : `AND a.id IN (
           SELECT m.asset_id
             FROM bms.asset_group_members m
             JOIN bms.asset_groups g ON g.id = m.asset_group_id AND g.location_id = $1::uuid
            WHERE m.asset_group_id = $2::uuid
         )`;
  const { rows } = await pool.query<SiteAssetRow>(
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

/** The location → organization → `UTC` chain (Amendment 2 item 8); a stored `UTC` reports `UTC`. */
export async function siteTimeZone(pool: Queryable, locationId: string): Promise<ResolvedSiteTimeZone> {
  const { rows } = await pool.query<{ location_zone: string | null; organization_zone: string | null }>(
    `SELECT l.timezone AS location_zone, o.timezone AS organization_zone
       FROM bms.locations l
       JOIN bms.organizations o ON o.id = l.organization_id
      WHERE l.id = $1::uuid`,
    [locationId],
  );
  const row = rows[0];
  return resolveSiteTimeZone(row?.location_zone ?? null, row?.organization_zone ?? null);
}
