import { resolveSiteTimeZone } from "@bms/shared";
import { sql, type SQL } from "drizzle-orm";
import type { Pool } from "pg";

import { isEnergyShown } from "../dashboard/energy-features";
import type { BmsTx } from "../database/tenant-context";
import { aggregateRelation, avgExpr } from "../telemetry/point-aggregates";
import type { HourlyEnergy } from "../telemetry/energy-cost-by-day";
import type { AdvisoryCandidate, AdvisoryPairHour } from "./advisory-engine.types";

/**
 * `E1.6a` / ADR 0137 decisions 2, 6 and 9 (plan T1.7, Q3, Q6, R-e) — the advisory
 * module's own SQL: four statements, every value a bound parameter, and nothing
 * written. Everything else the module reads is an existing read, reused unchanged.
 *
 * - **Candidates** run on the `tx` `withReadScope` hands them (Q3): on the tenant
 *   branch the `0047` FORCE policies scope `bms.assets`, `bms.locations`,
 *   `bms.asset_points` and `bms.rtus`; on the fleet branch (a global admin, or a
 *   caller whose assets span organizations) the `a.id = ANY(ids)` line is the
 *   control. That line is chosen by `ids === null`, never by the branch.
 * - **"Real"** is the ML scorer's own line (Q6), word for word
 *   (`apps/ml/src/bms_ml/db/sql.py`; `tests/e1.6-advisories-containment.test.ts`
 *   holds the text equal), on an active `kw` point.
 * - **The ranking, the baseline-hour and the pair reads** run on the fleet pool with the candidate
 *   ids only, never `null`; `= ANY($1::uuid[])` is their isolation control.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ids as one bound `uuid[]` literal; a non-UUID never reaches the statement. */
function uuidArray(ids: readonly string[]): string {
  for (const id of ids) {
    if (!UUID.test(id)) throw new Error("advisory read: an asset id is not a UUID");
  }
  return `{${ids.join(",")}}`;
}

/** One candidate row, every column aliased. */
export type AdvisoryCandidateDbRow = {
  asset_id: string;
  organization_id: string;
  location_id: string;
  asset_code: string;
  asset_name: string;
  asset_rtu_name: string | null;
  location_name: string;
  domain: string;
  /** The location's OWN zone; the organization's is not read (no zone, no advisory). */
  location_zone: string | null;
  currency: string;
  energy_features: string;
  has_pf: boolean | null;
  has_kva: boolean | null;
  has_kwh_total: boolean | null;
  has_kvah_total: boolean | null;
};

/**
 * The assets among `ids` (`null`: every asset the transaction can see) with an
 * active real `kw` point, with their labels, the location's own zone, the
 * organization's currency and energy setting, and which optional energy points
 * are active.
 */
export function advisoryCandidatesStatement(ids: readonly string[] | null): SQL {
  const assetFilter = ids === null ? sql`` : sql`AND a.id = ANY(${uuidArray(ids)}::uuid[])`;
  return sql`
    SELECT a.id AS asset_id, a.organization_id AS organization_id, a.location_id AS location_id,
           a.code AS asset_code, a.name AS asset_name, rtu.display_name AS asset_rtu_name,
           l.name AS location_name, a.domain AS domain,
           l.timezone AS location_zone, o.currency AS currency, o.energy_features AS energy_features,
           pts.has_pf AS has_pf, pts.has_kva AS has_kva,
           pts.has_kwh_total AS has_kwh_total, pts.has_kvah_total AS has_kvah_total
      FROM bms.assets a
      JOIN bms.locations l ON l.id = a.location_id
      JOIN bms.organizations o ON o.id = a.organization_id
      LEFT JOIN bms.rtus rtu ON rtu.id = a.rtu_id
      LEFT JOIN LATERAL (
        SELECT bool_or(p.point_key = 'pf') AS has_pf, bool_or(p.point_key = 'kva') AS has_kva,
               bool_or(p.point_key = 'kwh_total') AS has_kwh_total,
               bool_or(p.point_key = 'kvah_total') AS has_kvah_total
          FROM bms.asset_points p
         WHERE p.asset_id = a.id AND p.active AND p.point_key IN ('pf', 'kva', 'kwh_total', 'kvah_total')
      ) pts ON true
     WHERE EXISTS (
             SELECT 1
               FROM bms.asset_points ap
               LEFT JOIN bms.rtus r ON r.id = ap.rtu_id
              WHERE ap.asset_id = a.id
                AND ap.point_key = 'kw'
                AND ap.active
                AND (a.meta->>'telemetrySource' = 'mqtt' OR (ap.source_kind = 'measured' AND r.ingest_enabled))
           )
       ${assetFilter}
     ORDER BY a.id`;
}

/** Runs {@link advisoryCandidatesStatement} on the `tx` `withReadScope` hands it. */
export async function readAdvisoryCandidates(tx: BmsTx, ids: readonly string[] | null): Promise<AdvisoryCandidateDbRow[]> {
  const result = await tx.execute<AdvisoryCandidateDbRow>(advisoryCandidatesStatement(ids));
  return result.rows;
}

/**
 * A row as the engine's candidate, or `null` when it gets no advisory: no valid
 * zone of its own (ADR decision 2's `timezone_unset`; the organization's zone is
 * not a fallback here), or the organization's energy features off
 * (`isEnergyShown`, with energy data: the meter has a real `kw` point).
 */
export function candidateOf(row: AdvisoryCandidateDbRow): AdvisoryCandidate | null {
  if (row.location_zone === null) return null;
  const zone = resolveSiteTimeZone(row.location_zone, null);
  // The chain falls to UTC when the stored value is not valid; only the stored value itself counts.
  if (zone.timeZone !== row.location_zone) return null;
  if (!isEnergyShown(row.energy_features, true)) return null;
  return {
    assetId: row.asset_id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    assetCode: row.asset_code,
    assetName: row.asset_name,
    assetRtuName: row.asset_rtu_name,
    assetLocationName: row.location_name,
    domain: row.domain,
    timeZone: zone.timeZone,
    zone: zone.arithmeticZone,
    currency: row.currency.trim(),
    points: {
      pf: row.has_pf === true,
      kva: row.has_kva === true,
      kwhTotal: row.has_kwh_total === true,
      kvahTotal: row.has_kvah_total === true,
    },
  };
}

function relationOf(level: "1h"): string {
  const relation = aggregateRelation(level);
  if (!relation) throw new Error(`advisory read: no ${level} aggregate relation`);
  return relation;
}

/**
 * Plan R-e — the `limit` candidates with the highest `kw` energy since `sinceMs`
 * (the sum of hourly means of the `_1h` aggregate), highest first. Run only when
 * more candidates qualify than the cap. `pool` is the fleet pool.
 */
export async function readTopEnergyAssets(
  pool: Pick<Pool, "query">,
  ids: readonly string[],
  sinceMs: number,
  limit: number,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<{ asset_id: string }>(
    `SELECT p.asset_id AS asset_id
       FROM ${relationOf("1h")} p
      WHERE p.asset_id = ANY($1::uuid[])
        AND p.point_key = 'kw'
        AND p.bucket >= $2
      GROUP BY p.asset_id
      -- Ranking only: no bucketHours() factor, which is 1 for _1h, so the sum of hourly means is kWh.
      ORDER BY sum(p.sum_value / NULLIF(p.sample_count, 0)) DESC NULLS LAST, p.asset_id
      LIMIT $3`,
    [[...ids], new Date(sinceMs), limit],
  );
  return rows.map((row) => row.asset_id);
}

const PAIR_KEYS = ["kw", "kva", "pf"] as const;

/**
 * The hourly means of `kw`, `kva` and `pf` over `[fromMs, toMs)` from the `_1h`
 * aggregate, per asset and hour, oldest first: the power factor's estimated paths
 * (plan §4.2 step 1), read only for assets with no usable register pair. `pool`
 * is the fleet pool.
 */
export async function readPairHours(
  pool: Pick<Pool, "query">,
  ids: readonly string[],
  fromMs: number,
  toMs: number,
): Promise<Map<string, AdvisoryPairHour[]>> {
  const out = new Map<string, AdvisoryPairHour[]>();
  if (ids.length === 0) return out;
  const { rows } = await pool.query<{ asset_id: string; bucket_ms: number | string; point_key: string; mean: number | string | null }>(
    `SELECT p.asset_id AS asset_id, (extract(epoch FROM p.bucket) * 1000)::float8 AS bucket_ms,
            p.point_key AS point_key, (${avgExpr("p")})::float8 AS mean
       FROM ${relationOf("1h")} p
      WHERE p.asset_id = ANY($1::uuid[])
        AND p.point_key = ANY($2::text[])
        AND p.bucket >= $3 AND p.bucket < $4
      GROUP BY p.asset_id, p.bucket, p.point_key`,
    [[...ids], [...PAIR_KEYS], new Date(fromMs), new Date(toMs)],
  );
  const byAsset = new Map<string, Map<number, { kw: number | null; kva: number | null; pf: number | null }>>();
  for (const row of rows) {
    const bucketMs = Number(row.bucket_ms);
    const mean = row.mean === null ? null : Number(row.mean);
    const hours = byAsset.get(row.asset_id) ?? new Map<number, { kw: number | null; kva: number | null; pf: number | null }>();
    const hour = hours.get(bucketMs) ?? { kw: null, kva: null, pf: null };
    if (row.point_key === "kw" || row.point_key === "kva" || row.point_key === "pf") hour[row.point_key] = mean;
    hours.set(bucketMs, hour);
    byAsset.set(row.asset_id, hours);
  }
  for (const [assetId, hours] of byAsset) {
    out.set(
      assetId,
      [...hours.entries()].sort(([a], [b]) => a - b).map(([bucketMs, hour]) => ({ bucketMs, ...hour })),
    );
  }
  return out;
}

/**
 * `F4.384` (owner ruling 2026-11-17, plan Q2 option b) — the mean `kw` per asset per **UTC**
 * hour over `[fromMs, toMs)` from the `_1h` aggregate: kWh for a closed hour (`bucketHours("1h")`
 * is 1). The four baseline windows' hours; the window's own 7 days stay on
 * `readLocalHourEnergy`'s `_5m` local hours. In a half-hour zone a UTC hour straddles a local
 * day's edge, so a baseline day can be up to 30 minutes off — accepted under Q2 (b), for about a
 * twelfth of the rows. `pool` is the fleet pool; the candidate ids are the isolation control.
 */
export async function readUtcHourEnergy(
  pool: Pick<Pool, "query">,
  ids: readonly string[],
  fromMs: number,
  toMs: number,
): Promise<HourlyEnergy[]> {
  if (ids.length === 0 || toMs <= fromMs) return [];
  const { rows } = await pool.query<{ asset_id: string; bucket_ms: number | string; kwh: number | string }>(
    `SELECT p.asset_id AS asset_id, (extract(epoch FROM p.bucket) * 1000)::float8 AS bucket_ms,
            (${avgExpr("p")})::float8 AS kwh
       FROM ${relationOf("1h")} p
      WHERE p.asset_id = ANY($1::uuid[])
        AND p.point_key = 'kw'
        AND p.bucket >= $2 AND p.bucket < $3
      GROUP BY p.asset_id, p.bucket`,
    [[...ids], new Date(fromMs), new Date(toMs)],
  );
  return rows.map((row) => ({ assetId: row.asset_id, bucketMs: Number(row.bucket_ms), kwh: Number(row.kwh) }));
}
