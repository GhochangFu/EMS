import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { assets } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE } from "../database/database.tokens";
import { avgExpr } from "../telemetry/point-aggregates";
import { BACKTEST_WINDOW_MS } from "./rule-backtest";
import { ruleTargetPointKeysByAsset } from "./rule-points";
import { inventoryPairs, inventoryUnit, type InventoryAsset, type InventoryPair, type InventoryStats } from "./site-point-inventory-rows";

/**
 * `F4.288` (ADR 0099 Amendment 9 E2) — the reads behind the copilot's
 * `get_site_point_inventory`: a site's assets and their rule-target points,
 * and each point's 7-day statistics.
 *
 * **Containment.** Every asset id here comes from
 * `LocationAssetScopeService.readableAssetIdsInLocations` (`F4.291`, owner
 * ruling P5): a location placed in the turn's organizations, its subtree,
 * intersected with the caller's readable ids. No caller-supplied asset id
 * reaches these WHERE clauses, and the statistics read only the pairs
 * {@link pairs} built from those ids. `fleetDb`, because
 * `ruleTargetPointKeysByAsset` reads `template_points` (FORCE RLS) and
 * `telemetry.*` carries no Row Level Security: the ids are the control, as
 * in `RulesService.getBuilderCatalog`, whose point set this is.
 *
 * **Cost per tool call:** one asset read and the two rule-point queries over
 * the readable subtree (the cursor's offset is into their answer, so it is
 * read whole), then one statistics statement over the page's pairs only.
 */
@Injectable()
export class SitePointInventoryService {
  constructor(@Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb) {}

  /**
   * The assets among `assetIds` (optionally of one `domain`) by code, then
   * id, and every (asset, point) pair of the rule point set
   * (`ruleTargetPointKeysByAsset`, ADR 0058 Amendment 4 — the picker's set)
   * in that order. `[]` reads nothing.
   */
  async pairs(assetIds: readonly string[], domain?: string): Promise<{ assets: InventoryAsset[]; pairs: InventoryPair[] }> {
    if (assetIds.length === 0) return { assets: [], pairs: [] };
    const rows = await this.fleetDb
      .select({ id: assets.id, code: assets.code, name: assets.name, domain: assets.domain })
      .from(assets)
      .where(and(inArray(assets.id, [...assetIds]), domain === undefined ? undefined : eq(assets.domain, domain)))
      .orderBy(asc(assets.code), asc(assets.id));
    const keys = await ruleTargetPointKeysByAsset(this.fleetDb, rows);
    return { assets: rows, pairs: inventoryPairs(rows, keys) };
  }

  /**
   * One answer per pair, in the pairs' order, over the 1-minute buckets of
   * `[now − 7 d, now)` (the backtest's own window and source). The mean is
   * composed (`avgExpr`, the only correct mean of these views); `last` is the
   * newest bucket's mean (owner ruling P6), not the raw latest sample. A
   * pair with no bucket answers `samples: 0` and null figures. The unit is
   * the samples', else the asset's active mapping's, else the catalog's.
   */
  async stats(pairs: readonly InventoryPair[], now: Date): Promise<InventoryStats[]> {
    if (pairs.length === 0) return [];
    const from = new Date(now.getTime() - BACKTEST_WINDOW_MS);
    const result = await this.fleetDb.execute<{
      asset_id: string;
      point_key: string;
      min: number | string | null;
      max: number | string | null;
      avg: number | string | null;
      last: number | string | null;
      samples: number | string | null;
      sample_unit: string | null;
      mapping_unit: string | null;
      catalog_unit: string | null;
    }>(sql`
      WITH asked AS (
        SELECT * FROM unnest(${sql.param(pairs.map((p) => p.assetId))}::uuid[], ${sql.param(pairs.map((p) => p.pointKey))}::text[])
          AS p(asset_id, point_key)
      ), stats AS (
        SELECT v.asset_id, v.point_key,
               min(v.min_value) AS min,
               max(v.max_value) AS max,
               ${sql.raw(avgExpr("v"))} AS avg,
               (array_agg(v.sum_value / v.sample_count ORDER BY v.bucket DESC))[1] AS last,
               sum(v.sample_count) AS samples,
               max(v.unit) AS sample_unit
          FROM telemetry.point_values_1m v
          JOIN asked a ON a.asset_id = v.asset_id AND a.point_key = v.point_key
         WHERE v.bucket >= ${from.toISOString()}::timestamptz
           AND v.bucket < ${now.toISOString()}::timestamptz
           AND v.sample_count > 0
         GROUP BY v.asset_id, v.point_key
      )
      SELECT a.asset_id, a.point_key, s.min, s.max, s.avg, s.last, s.samples, s.sample_unit,
             ap.unit AS mapping_unit, pk.unit AS catalog_unit
        FROM asked a
        LEFT JOIN stats s ON s.asset_id = a.asset_id AND s.point_key = a.point_key
        LEFT JOIN bms.asset_points ap ON ap.asset_id = a.asset_id AND ap.point_key = a.point_key AND ap.active
        LEFT JOIN bms.point_keys pk ON pk.code = a.point_key`);
    const byPair = new Map(result.rows.map((row) => [`${row.asset_id}\u0000${row.point_key}`, row]));
    return pairs.map((pair) => {
      const row = byPair.get(`${pair.assetId}\u0000${pair.pointKey}`);
      return {
        unit: inventoryUnit(row?.sample_unit ?? null, row?.mapping_unit ?? null, row?.catalog_unit ?? null),
        min: numberOrNull(row?.min),
        avg: numberOrNull(row?.avg),
        max: numberOrNull(row?.max),
        last: numberOrNull(row?.last),
        samples: Number(row?.samples ?? 0),
      };
    });
  }

  /**
   * `F4.296` (ADR 0099 Amendment 10 F2) — each pair's unit without its
   * statistics, for the copilot's `unruled` read: the asset's active
   * mapping's, else the fleet catalog's (`inventoryUnit` without the
   * samples' own unit). No `telemetry.*` read, so its cost does not grow with
   * the 7-day window; one answer per pair, in the pairs' order. `[]` reads
   * nothing.
   */
  async units(pairs: readonly InventoryPair[]): Promise<Array<string | null>> {
    if (pairs.length === 0) return [];
    const result = await this.fleetDb.execute<{ asset_id: string; point_key: string; mapping_unit: string | null; catalog_unit: string | null }>(sql`
      WITH asked AS (
        SELECT * FROM unnest(${sql.param(pairs.map((p) => p.assetId))}::uuid[], ${sql.param(pairs.map((p) => p.pointKey))}::text[])
          AS p(asset_id, point_key)
      )
      SELECT a.asset_id, a.point_key, ap.unit AS mapping_unit, pk.unit AS catalog_unit
        FROM asked a
        LEFT JOIN bms.asset_points ap ON ap.asset_id = a.asset_id AND ap.point_key = a.point_key AND ap.active
        LEFT JOIN bms.point_keys pk ON pk.code = a.point_key`);
    const byPair = new Map(result.rows.map((row) => [`${row.asset_id}\u0000${row.point_key}`, row]));
    return pairs.map((pair) => {
      const row = byPair.get(`${pair.assetId}\u0000${pair.pointKey}`);
      return inventoryUnit(null, row?.mapping_unit ?? null, row?.catalog_unit ?? null);
    });
  }
}

/** `numeric` and `bigint` arrive as strings from `pg`. */
function numberOrNull(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}
