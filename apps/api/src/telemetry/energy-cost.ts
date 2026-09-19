import type { Pool } from "pg";

import { inputKey } from "../calc/calc-batch";
import { aggregateRelation, avgExpr, type AggregateLevel } from "./point-aggregates";

/**
 * `E4.1c` — the indicative energy cost, read from a parameter rather than an
 * environment variable (ADR 0070 decision 7).
 *
 * ## What this replaces
 *
 * `DashboardService` and `ReportsService` each carried a private tariff reader
 * that took one number from the process environment with a hardcoded Rand
 * default, and the DTO fields named that currency. Both readers are deleted in
 * the same pull request as this file, and `tests/adr-0070-calc-v3-invariants`
 * part (f) scans the tree so neither the variable nor the old field names can
 * come back. (The variable and the default are deliberately not spelled here:
 * a comment *about* them must not be what the scan finds.)
 *
 * The tariff is now `energy_tariff_per_kwh`, a `bms.calc_parameters` row the
 * organization enters on `/admin/calc-parameters`, resolved **per asset at the
 * nearest scope** through `CalcParametersService.resolveForAssets` (the
 * owner's Q4 ruling of 2026-09-19): the organization row for everyone, a
 * location row where one exists, an asset row where one exists. The currency
 * is `bms.organizations.currency` (migration `0076`), joined onto the same
 * per-asset statement. Both services reduce their per-asset rows to this
 * function's input and return its output as the contract's three fields.
 *
 * ## The three fail-closed rules
 *
 * - **`currency`** is the one distinct currency of the rows, else `null`. A
 *   global administrator whose scope spans two organizations in two currencies
 *   sees the dash: a sum across currencies is not a number. A row with no
 *   currency (orphan telemetry, above) counts as its own "currency", so one
 *   such row is enough to answer the dash rather than a smaller number.
 * - **`tariffPerKwh`** is the one distinct resolved tariff when **every** row
 *   resolved, else `null`. Two tariffs in scope (a location override beside
 *   the organization row) still sum — per asset — but there is no single
 *   tariff to show on the ribbon.
 * - **`indicativeCost`** is Σ `kwh_i × tariff_i`, rounded to two decimals, when
 *   every row resolved **and** `currency` is non-null, else `null`. A partial
 *   sum understates, which is worse than no number.
 *
 * `null`, never `0`, is ADR 0070 decision 2's rule at the read, and it is why
 * the contract's three fields went `.nullable()`. **No default value anywhere**:
 * `tests/adr-0070` part (g) scans this file for `COALESCE(`, `?? 0` and `?? 1`.
 */

/** The parameter key both reads resolve (`bms.calc_parameter_keys`, migration `0074`). */
export const ENERGY_TARIFF_KEY = "energy_tariff_per_kwh";

/** One asset's energy in the window, as both services' per-asset statement returns it. */
export interface PerAssetEnergy {
  readonly assetId: string;
  readonly kwh: number;
  /**
   * `bms.organizations.currency` of the asset's organization (ISO 4217), or
   * `null` for telemetry whose `asset_id` has no `bms.assets` row —
   * `telemetry.point_values` carries no foreign key, and a total that counts
   * such rows must not be priced (rule 1 below turns the `null` into no
   * currency, and so no cost).
   */
  readonly currency: string | null;
}

/** The three contract fields, in the shape `energyCentreSummarySchema` declares them. */
export interface EnergyCostResult {
  readonly indicativeCost: number | null;
  readonly tariffPerKwh: number | null;
  readonly currency: string | null;
}

const NOTHING: EnergyCostResult = { indicativeCost: null, tariffPerKwh: null, currency: null };

/**
 * Reduce the per-asset rows and their resolved tariffs to the contract's three
 * fields. `tariffs` is keyed by `assetId`; an entry for an asset that is not in
 * `rows` is ignored (the resolver answers every pair it was asked, and the
 * caller may ask for more than it sums).
 */
export function energyCost(
  rows: readonly PerAssetEnergy[],
  tariffs: ReadonlyMap<string, number>,
): EnergyCostResult {
  if (rows.length === 0) {
    return NOTHING;
  }

  const currencies = new Set(rows.map((row) => row.currency));
  const currency = currencies.size === 1 ? rows[0]!.currency : null;
  // `Set` size 1 with a `null` member is "one distinct value", which is not a
  // currency: the orphan-telemetry case, priced by nobody.

  let sum = 0;
  const distinctTariffs = new Set<number>();
  for (const row of rows) {
    const tariff = tariffs.get(row.assetId);
    if (tariff === undefined || !Number.isFinite(tariff) || !Number.isFinite(row.kwh)) {
      // One unresolved asset fails the whole read closed: a partial sum is
      // not "the cost of the scope", it is a smaller number with the same label.
      return { indicativeCost: null, tariffPerKwh: null, currency };
    }
    distinctTariffs.add(tariff);
    sum += row.kwh * tariff;
  }

  const tariffPerKwh = distinctTariffs.size === 1 ? [...distinctTariffs][0]! : null;
  const indicativeCost = currency === null ? null : Math.round(sum * 100) / 100;
  return { indicativeCost, tariffPerKwh: currency === null ? null : tariffPerKwh, currency };
}

/**
 * The window a per-asset read covers. `trailing` is the dashboard's — the
 * **database** clock, `bucket > now() - interval`, the same predicate its kWh
 * total uses, so `indicativeCost` and `totalKwh` describe the same window
 * (two statements, two `now()`; a minute boundary between them can move the
 * trailing edge by one `_1m` bucket, which the two-decimal rounding absorbs
 * everywhere but at a bucket edge). `range` is the report's, `bucket >= start AND bucket <= end`.
 * The two are kept as two arms rather than unified so that each service's
 * cost sums exactly the buckets its total sums (the integration specs pin
 * `indicativeCost === round(totalKwh × tariff)` on both).
 */
export type EnergyCostWindow =
  | { readonly kind: "trailing"; readonly intervalSql: string }
  | { readonly kind: "range"; readonly start: Date; readonly end: Date };

export interface PerAssetEnergyOptions {
  readonly level: AggregateLevel;
  readonly window: EnergyCostWindow;
  /** Bucket width in hours at `level` — `bucketHours(level)`; kW × hours = kWh. */
  readonly kwhFactor: number;
  readonly assetIds: readonly string[] | null;
}

interface PerAssetEnergyRow {
  readonly asset_id: string;
  readonly kwh: string;
  readonly currency: string | null;
}

/**
 * Energy per asset in the window, with each asset's organization currency —
 * the database half. Reads the continuous aggregate at `level` (ADR 0023) with
 * the same `avgExpr` mean the totals use, and joins `bms.assets` and
 * `bms.organizations` for the currency. **Both joins are LEFT**: the totals
 * this read must agree with join nothing, so an `asset_id` in the aggregate
 * with no `bms.assets` row (no foreign key holds the two together) is still
 * a row here — with `currency: null` — rather than a silent omission that
 * would leave the cost non-null and smaller than the total it is labelled
 * with. The PR 1 code review found the inner join (C1). `pool` is the caller's `FLEET_POOL`,
 * and the `$1::uuid[]` scope from `AccessControlService.readableAssetIds` is
 * the isolation control (`pue-ratio.ts` §Containment gives the reason in
 * full); `bms.organizations` carries no row-level security (measured at the
 * `E4.1c` plan gate) and `bms.assets` is read by the fleet role here as it is
 * by every other fleet-pool statement in the two services.
 */
export async function perAssetEnergy(
  pool: Pool,
  { level, window, kwhFactor, assetIds }: PerAssetEnergyOptions,
): Promise<PerAssetEnergy[]> {
  const relation = aggregateRelation(level);
  if (!relation) {
    throw new Error(`perAssetEnergy: unknown aggregate level "${level}"`);
  }
  const bound =
    window.kind === "trailing" ? "bucket > now() - $3::interval" : "bucket >= $3 AND bucket <= $4";
  const params: unknown[] =
    window.kind === "trailing"
      ? [assetIds ?? null, kwhFactor, window.intervalSql]
      : [assetIds ?? null, kwhFactor, window.start, window.end];
  const r = await pool.query<PerAssetEnergyRow>(
    `
    WITH per AS (
      SELECT bucket, asset_id, ${avgExpr()} AS kw
      FROM ${relation}
      WHERE point_key = 'kw'
        AND ${bound}
        AND ($1::uuid[] IS NULL OR asset_id = ANY($1::uuid[]))
      GROUP BY 1, 2
    )
    SELECT p.asset_id,
           (SUM(p.kw) * $2::float8)::float8 AS kwh,
           o.currency
    FROM per p
    LEFT JOIN bms.assets a ON a.id = p.asset_id
    LEFT JOIN bms.organizations o ON o.id = a.organization_id
    GROUP BY p.asset_id, o.currency
    `,
    params,
  );
  return r.rows.map((row) => ({ assetId: row.asset_id, kwh: Number(row.kwh), currency: row.currency }));
}

/** The one method of `CalcParametersService` the two reads need — what the services inject. */
export interface TariffResolver {
  resolveForAssets(
    pairs: readonly { readonly assetId: string; readonly key: string }[],
    at: Date,
  ): Promise<Map<string, number>>;
}

/**
 * Resolve `energy_tariff_per_kwh` for every asset in `rows` at `at` — the
 * nearest scope per asset — and re-key the resolver's `inputKey` map by
 * `assetId` for {@link energyCost}. An asset with no row in scope is simply
 * absent from the result; `energyCost` is where absence fails closed.
 */
export async function resolveTariffs(
  resolver: TariffResolver,
  rows: readonly PerAssetEnergy[],
  at: Date,
): Promise<Map<string, number>> {
  const resolved = await resolver.resolveForAssets(
    rows.map((row) => ({ assetId: row.assetId, key: ENERGY_TARIFF_KEY })),
    at,
  );
  const byAsset = new Map<string, number>();
  for (const row of rows) {
    const value = resolved.get(inputKey(row.assetId, ENERGY_TARIFF_KEY));
    if (value !== undefined) {
      byAsset.set(row.assetId, value);
    }
  }
  return byAsset;
}
