import { resolveSiteTimeZone } from "@bms/shared";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Pool } from "pg";

import { ancestorChainsCte } from "../auth/location-tree";

const dialect = new PgDialect();

/**
 * `F4.365` (ADR 0134 decision 3) — a location's tariff mappings, read on the
 * fleet pool with the zone and currency the bill needs. Every statement keeps
 * the mapping's organization equal to the location's (plan D12).
 */
export interface MappingRow {
  id: string;
  organizationId: string;
  locationId: string;
  tariffKey: string;
  /** The primary billing meter: the first of {@link billingMeterAssetIds}. */
  billingMeterAssetId: string;
  /**
   * Every billing meter (ADR 0134 Amendment 3), read from `bms.location_tariff_meters`,
   * the primary first. Never empty: a mapping with no meter rows (written by raw SQL,
   * not by the API, which writes both in one transaction) reads as its primary alone.
   */
  billingMeterAssetIds: string[];
  sanctionedLoad: number;
  sanctionedLoadUnit: "kw" | "kva" | "hp";
  effectiveFrom: string;
  effectiveTo: string | null;
  /** IANA zone the month is cut in (`resolveSiteTimeZone(...).arithmeticZone`). */
  zone: string;
  /** The zone as shown (`resolveSiteTimeZone(...).timeZone`). */
  timeZone: string;
  currency: string | null;
}

/** The mapping whose `[effectiveFrom, effectiveTo)` contains `firstDay`, else null. */
export function mappingInForce<T extends Pick<MappingRow, "effectiveFrom" | "effectiveTo">>(rows: readonly T[], firstDay: string): T | null {
  return rows.find((r) => r.effectiveFrom <= firstDay && (r.effectiveTo === null || firstDay < r.effectiveTo)) ?? null;
}

interface Row {
  id: string;
  organization_id: string;
  location_id: string;
  tariff_key: string;
  billing_meter_asset_id: string;
  billing_meter_asset_ids: string[] | null;
  sanctioned_load: string;
  sanctioned_load_unit: "kw" | "kva" | "hp";
  effective_from: string;
  effective_to: string | null;
  location_zone: string | null;
  organization_zone: string | null;
  currency: string | null;
}

const SELECT = `
  SELECT lt.id, lt.organization_id, lt.location_id, lt.tariff_key, lt.billing_meter_asset_id,
         ARRAY(SELECT m.asset_id::text FROM bms.location_tariff_meters m
                WHERE m.location_tariff_id = lt.id AND m.organization_id = lt.organization_id
                ORDER BY m.asset_id = lt.billing_meter_asset_id DESC, m.asset_id) AS billing_meter_asset_ids,
         lt.sanctioned_load, lt.sanctioned_load_unit,
         to_char(lt.effective_from, 'YYYY-MM-DD') AS effective_from,
         to_char(lt.effective_to, 'YYYY-MM-DD') AS effective_to,
         l.timezone AS location_zone, o.timezone AS organization_zone, o.currency
    FROM bms.location_tariffs lt
    JOIN bms.locations l ON l.id = lt.location_id AND l.organization_id = lt.organization_id
    JOIN bms.organizations o ON o.id = lt.organization_id`;

/** The meter rows with the primary first; the primary alone when there are none. */
export function meterList(primary: string, rows: readonly string[] | null): string[] {
  const others = (rows ?? []).filter((id) => id !== primary);
  return [primary, ...others];
}

export function toMappingRow(r: Row): MappingRow {
  const zone = resolveSiteTimeZone(r.location_zone, r.organization_zone);
  return {
    id: r.id,
    organizationId: r.organization_id,
    locationId: r.location_id,
    tariffKey: r.tariff_key,
    billingMeterAssetId: r.billing_meter_asset_id,
    billingMeterAssetIds: meterList(r.billing_meter_asset_id, r.billing_meter_asset_ids),
    sanctionedLoad: Number(r.sanctioned_load),
    sanctionedLoadUnit: r.sanctioned_load_unit,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    zone: zone.arithmeticZone,
    timeZone: zone.timeZone,
    currency: r.currency === null ? null : r.currency.trim(),
  };
}

export async function readMappingsForLocation(
  pool: Pick<Pool, "query">,
  organizationId: string,
  locationId: string,
): Promise<MappingRow[]> {
  const { rows } = await pool.query<Row>(
    `${SELECT} WHERE lt.organization_id = $1 AND lt.location_id = $2 ORDER BY lt.effective_from`,
    [organizationId, locationId],
  );
  return rows.map(toMappingRow);
}

/**
 * For each asset, the mappings of the NEAREST location in its ancestor chain
 * that has any (ADR 0134 decision 7: a mapped site prices every asset under
 * it). The walk is `ancestorChainsCte` (`auth/location-tree.ts`), the one
 * recursive walk the repo declares, embedded as the statement's prefix and
 * anchored on each asset's own `(location_id, organization_id)` — so the walk
 * carries the per-step organization predicate and depth bound — then rendered
 * to text for this module's raw `pg` pool.
 */
export async function readMappingsForAssets(
  pool: Pick<Pool, "query">,
  assetIds: readonly string[],
): Promise<Map<string, MappingRow[]>> {
  const out = new Map<string, MappingRow[]>();
  if (assetIds.length === 0) return out;
  const ids = sql.param([...assetIds]);
  const query = dialect.sqlToQuery(sql`
    ${ancestorChainsCte({
      pairs: sql`SELECT a.location_id, a.organization_id FROM bms.assets a WHERE a.id = ANY(${ids}::uuid[])`,
    })},
    nearest AS (
      SELECT DISTINCT ON (a.id) a.id AS asset_id, anc.ancestor_id AS location_id, anc.organization_id, anc.steps
        FROM bms.assets a
        JOIN anc ON anc.node_id = a.location_id AND anc.organization_id = a.organization_id
       WHERE a.id = ANY(${ids}::uuid[])
         AND EXISTS (SELECT 1 FROM bms.location_tariffs lt
                      WHERE lt.location_id = anc.ancestor_id AND lt.organization_id = anc.organization_id)
       ORDER BY a.id, anc.steps
    )
    SELECT n.asset_id, n.steps, m.*
      FROM nearest n
      JOIN LATERAL (${sql.raw(SELECT)} WHERE lt.location_id = n.location_id AND lt.organization_id = n.organization_id) m ON true
     ORDER BY n.asset_id, m.effective_from`);
  const { rows } = await pool.query<Row & { asset_id: string; steps: number }>(query.sql, query.params);
  for (const r of rows) {
    const list = out.get(r.asset_id);
    const row = toMappingRow(r);
    if (list) list.push(row);
    else out.set(r.asset_id, [row]);
  }
  return out;
}
