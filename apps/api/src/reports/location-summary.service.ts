import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";

import type { BmsDb } from "@bms/db";

import { locationAncestorChains } from "../auth/location-tree";
import { FLEET_DRIZZLE, FLEET_POOL } from "../database/database.tokens";
import { perAssetEnergy } from "../telemetry/energy-cost";
import { aggregateRelation, bucketHours, levelForRange } from "../telemetry/point-aggregates";
import type { ReportRange } from "./reports.service";

/** A row's location: its id and its name, the order key with the id. */
export type LocationSummaryKey = { readonly id: string; readonly name: string };

/**
 * One location's summary over a range: its readable assets (the location and
 * every descendant), kWh where any asset has `kw` data (`null` when none has),
 * alarms raised in the range and, of those, still open, by severity (a
 * severity with no alarm is absent), and the assets with no telemetry in the
 * range (a count, and the first {@link NO_DATA_CODES_SHOWN} codes).
 */
export type LocationSummaryRow = {
  readonly id: string;
  readonly name: string;
  readonly assets: number;
  readonly kwh: number | null;
  readonly raised: Record<string, number>;
  readonly open: Record<string, number>;
  readonly noData: number;
  readonly noDataCodes: readonly string[];
};

/** A row's name is cut to this many characters (the column holds 255). */
export const LOCATION_SUMMARY_NAME_CHARS = 80;

/** How many no-data asset codes a row names; `noData` counts them all. */
export const NO_DATA_CODES_SHOWN = 3;

export type LocationSummaryRows =
  | { readonly ok: true; readonly rows: readonly LocationSummaryKey[] }
  | { readonly ok: false; readonly reason: "not_found" | "outside_grant" };

/**
 * `F4.290` PR 2 (ADR 0099 Amendment 9 E4) — the reads behind the copilot's
 * `get_location_summary`: one row per location, each rolled up over its
 * subtree, so "a summary report for all locations" is one call.
 *
 * **Which rows** ({@link rows}). Named `locationIds`: exactly those, each a
 * location of the organization (else `not_found`) and, for a scoped caller,
 * one of its readable locations (else `outside_grant` — the plan critic's
 * scope-leak fix: a location the caller cannot read is never named back).
 * None named (owner ruling 2026-10-29): the top-level sites the caller can
 * read — the roots of the readable scope, the active locations of the
 * organization (∩ the caller's readable locations) whose parent is not
 * among them.
 *
 * **Containment.** Every asset id comes from the tool's
 * `readPerOrganization` (the caller's readable ids of the organization, or of
 * the named subtrees through `LocationAssetScopeService`, owner ruling P5);
 * an asset counts toward a row only when the row is in its location's
 * ancestor chain. No caller-supplied id reaches an asset WHERE. `fleetDb` /
 * the fleet pool, because `bms.assets` and `bms.alarms` are FORCE-policied
 * and `telemetry.*` carries no Row Level Security: the ids are the control,
 * as in `ReportsService`.
 *
 * **kWh is the report's own expression**: `perAssetEnergy` (the per-asset
 * read the report's cost uses) at the level `levelForRange` picks for the
 * report's `1h` granularity, over the report's bounds (`energyReportRange`),
 * so a row's kWh equals `GET /reports/energy/preview?locationIds=<row>`'s
 * `totalKwh` for the same dates and scope.
 *
 * **Cost per call:** one location read for the rows; then, for one page, one
 * asset read, one ancestor walk (`locationAncestorChains`, no new recursive
 * CTE), and one kWh, one alarm and one no-data statement over the page's
 * assets only.
 */
@Injectable()
export class LocationSummaryService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: Pick<BmsDb, "execute">,
    @Inject(FLEET_POOL) private readonly pool: Pool,
  ) {}

  /** The candidate rows in `(name, id)` order, or the reason the named locations are refused. */
  async rows(
    organizationId: string,
    scopeLocationIds: readonly string[] | null,
    locationIds?: readonly string[],
  ): Promise<LocationSummaryRows> {
    if (locationIds !== undefined) {
      const named = [...new Set(locationIds)];
      const found = await this.fleetDb.execute<{ id: string; name: string }>(sql`
        SELECT l.id, l.name
          FROM bms.locations l
         WHERE l.organization_id = ${organizationId}
           AND l.id = ANY(${sql.param(named)}::uuid[])
         ORDER BY l.name, l.id`);
      if (found.rows.length !== named.length) return { ok: false, reason: "not_found" };
      if (scopeLocationIds !== null && !named.every((id) => scopeLocationIds.includes(id))) {
        return { ok: false, reason: "outside_grant" };
      }
      return { ok: true, rows: found.rows.map((row) => ({ id: row.id, name: row.name })) };
    }
    const scope = scopeLocationIds === null ? null : sql.param([...scopeLocationIds]);
    const active = await this.fleetDb.execute<{ id: string; name: string; parent_id: string | null }>(sql`
      SELECT l.id, l.name, l.parent_id
        FROM bms.locations l
       WHERE l.organization_id = ${organizationId}
         AND l.active = true
         ${scope === null ? sql`` : sql`AND l.id = ANY(${scope}::uuid[])`}
       ORDER BY l.name, l.id`);
    const ids = new Set(active.rows.map((row) => row.id));
    const roots = active.rows.filter((row) => row.parent_id === null || !ids.has(row.parent_id));
    return { ok: true, rows: roots.map((row) => ({ id: row.id, name: row.name })) };
  }

  /** One summary per row of `page`, in its order, over the readable `assetIds` and the report's `range`. */
  async summarise(
    organizationId: string,
    page: readonly LocationSummaryKey[],
    assetIds: readonly string[],
    range: Pick<ReportRange, "start" | "end">,
  ): Promise<LocationSummaryRow[]> {
    const members = await this.membersOf(organizationId, page, assetIds);
    const union = [...new Set([...members.values()].flat().map((asset) => asset.id))];
    const [kwh, alarms, withData] =
      union.length === 0
        ? [new Map<string, number>(), [], new Set<string>()]
        : await Promise.all([this.kwhByAsset(union, range), this.alarmsByAsset(union, range), this.assetsWithData(union, range)]);
    return page.map((row) => {
      const assets = members.get(row.id) ?? [];
      const own = new Set(assets.map((asset) => asset.id));
      const metered = assets.filter((asset) => kwh.has(asset.id));
      const noData = assets.filter((asset) => !withData.has(asset.id));
      const raised: Record<string, number> = {};
      const open: Record<string, number> = {};
      for (const alarm of alarms) {
        if (!own.has(alarm.assetId)) continue;
        raised[alarm.severity] = (raised[alarm.severity] ?? 0) + alarm.raised;
        if (alarm.open > 0) open[alarm.severity] = (open[alarm.severity] ?? 0) + alarm.open;
      }
      return {
        id: row.id,
        name: row.name.slice(0, LOCATION_SUMMARY_NAME_CHARS),
        assets: assets.length,
        kwh: metered.length === 0 ? null : round2(metered.reduce((sum, asset) => sum + (kwh.get(asset.id) ?? 0), 0)),
        raised,
        open,
        noData: noData.length,
        noDataCodes: noData.slice(0, NO_DATA_CODES_SHOWN).map((asset) => asset.code),
      };
    });
  }

  /** Each row's readable assets, by code: an asset whose location's ancestor chain holds the row. */
  private async membersOf(
    organizationId: string,
    page: readonly LocationSummaryKey[],
    assetIds: readonly string[],
  ): Promise<Map<string, Array<{ id: string; code: string }>>> {
    const out = new Map<string, Array<{ id: string; code: string }>>();
    if (page.length === 0 || assetIds.length === 0) return out;
    const assets = await this.fleetDb.execute<{ id: string; code: string; location_id: string }>(sql`
      SELECT a.id, a.code, a.location_id
        FROM bms.assets a
       WHERE a.organization_id = ${organizationId}
         AND a.id = ANY(${sql.param([...assetIds])}::uuid[])
       ORDER BY a.code, a.id`);
    const nodes = [...new Set(assets.rows.map((asset) => asset.location_id))];
    const chains = await locationAncestorChains(this.fleetDb, { organizationIds: [organizationId], ids: nodes });
    const ancestors = new Map<string, Set<string>>();
    for (const link of chains) {
      const set = ancestors.get(link.nodeId) ?? new Set<string>();
      set.add(link.ancestorId);
      ancestors.set(link.nodeId, set);
    }
    for (const row of page) {
      out.set(
        row.id,
        assets.rows.filter((asset) => ancestors.get(asset.location_id)?.has(row.id) === true).map((asset) => ({ id: asset.id, code: asset.code })),
      );
    }
    return out;
  }

  /** The report's per-asset kWh (`perAssetEnergy`), absent for an asset with no `kw` bucket in the range. */
  private async kwhByAsset(assetIds: readonly string[], range: Pick<ReportRange, "start" | "end">): Promise<Map<string, number>> {
    const { level } = levelForRange({ start: range.start, granularity: "1h" });
    const rows = await perAssetEnergy(this.pool, {
      level,
      window: { kind: "range", start: range.start, end: range.end },
      kwhFactor: bucketHours(level),
      assetIds,
    });
    return new Map(rows.map((row) => [row.assetId, row.kwh]));
  }

  /** Alarms raised in the range, per asset and severity, and how many of them are not cleared (ADR 0057). */
  private async alarmsByAsset(
    assetIds: readonly string[],
    range: Pick<ReportRange, "start" | "end">,
  ): Promise<Array<{ assetId: string; severity: string; raised: number; open: number }>> {
    const result = await this.fleetDb.execute<{ asset_id: string; severity: string; raised: number; open: number }>(sql`
      SELECT a.asset_id, a.severity,
             count(*)::int AS raised,
             (count(*) FILTER (WHERE a.cleared_at IS NULL))::int AS open
        FROM bms.alarms a
       WHERE a.asset_id = ANY(${sql.param([...assetIds])}::uuid[])
         AND a.raised_at >= ${range.start.toISOString()}::timestamptz
         AND a.raised_at <= ${range.end.toISOString()}::timestamptz
       GROUP BY a.asset_id, a.severity`);
    return result.rows.map((row) => ({ assetId: row.asset_id, severity: row.severity, raised: Number(row.raised), open: Number(row.open) }));
  }

  /** The assets with any telemetry bucket in the range, at the level the kWh reads. */
  private async assetsWithData(assetIds: readonly string[], range: Pick<ReportRange, "start" | "end">): Promise<Set<string>> {
    const { level } = levelForRange({ start: range.start, granularity: "1h" });
    const relation = aggregateRelation(level);
    if (relation === undefined) throw new Error(`LocationSummaryService: unknown aggregate level "${level}"`);
    const result = await this.fleetDb.execute<{ asset_id: string }>(sql`
      SELECT DISTINCT v.asset_id
        FROM ${sql.raw(relation)} v
       WHERE v.asset_id = ANY(${sql.param([...assetIds])}::uuid[])
         AND v.bucket >= ${range.start.toISOString()}::timestamptz
         AND v.bucket <= ${range.end.toISOString()}::timestamptz`);
    return new Set(result.rows.map((row) => row.asset_id));
  }
}

/** Two decimals, as the report rounds its totals. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
