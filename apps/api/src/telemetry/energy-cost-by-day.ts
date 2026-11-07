import {
  resolveSiteTimeZone,
  type EnergyCostDayRow,
  type EnergyCostPeriod,
  type EnergyCostReason,
} from "@bms/shared";
import type { Pool } from "pg";

import { inputKey } from "../calc/calc-batch";
import { parameterValueAt, type ParameterSeriesRow } from "../calc/calc-parameter-series";
import { ENERGY_TARIFF_KEY } from "./energy-cost";
import { aggregateRelation, avgExpr } from "./point-aggregates";

/**
 * `F4.332` (ADR 0070 Amendment 7) — the energy cost per local day, priced hour by hour at the
 * rate in force, computed when it is read.
 *
 * `cost(asset, hour) = kWh(asset, hour) × rate(asset, hour)`:
 * - `kWh` is the mean `kw` over the asset's LOCAL hour × 1 h: the `_5m` continuous aggregate
 *   folded into local hours with `avgExpr()` (see the read for why not `_1h`). An hour with no
 *   bucket adds no energy.
 * - `rate` is the `energy_tariff_per_kwh` row in force at the START of that hour, nearest scope
 *   (`CalcParametersService.resolveSeriesForAssets` + `parameterValueAt`). Editing an old rate
 *   row therefore re-prices exactly the hours it covers, on the next read; nothing is stored.
 *
 * The day is the calendar date in the asset's location zone (`resolveSiteTimeZone`); a scope's
 * day D is the sum of its assets' day D. Each day is rounded to two decimals once, and every
 * window total is the sum of those rounded figures ({@link sumCostDays}).
 *
 * **`null`, never `0`** (decision 5): `currency_mixed` for every day when the scope holds more
 * than one currency; `no_energy` for a day with no hourly bucket; `rate_missing` for a day in
 * which an hour with energy has no rate in force (one unpriced hour fails that day closed, the
 * `energyCost` rule). No default value anywhere.
 */

/** One asset in scope, with what pricing and the day boundary need. */
export interface CostScopeAsset {
  readonly assetId: string;
  /** The arithmetic zone of the asset's location (`resolveSiteTimeZone(...).arithmeticZone`). */
  readonly zone: string;
  readonly currency: string | null;
}

/** One hourly bucket of one asset's energy. */
export interface HourlyEnergy {
  readonly assetId: string;
  /** The bucket's start, epoch ms. */
  readonly bucketMs: number;
  readonly kwh: number;
}

/** A tariff series per asset, keyed by `assetId` (sorted by rank, as the read returns it). */
export type TariffSeriesByAsset = ReadonlyMap<string, readonly ParameterSeriesRow[]>;

const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The local calendar date of `ms` in `zone`, `YYYY-MM-DD`. */
export function localDay(ms: number, zone: string): string {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    // `en-CA` formats a date as `YYYY-MM-DD`.
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(zone, formatter);
  }
  return formatter.format(new Date(ms));
}

/** `day` moved by `delta` calendar days. Pure calendar arithmetic on the label: no zone, no DST. */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** The `count` local days ending today (`today` last), oldest first. */
export function windowDays(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftDay(today, i - (count - 1)));
}

/** How many days a period covers, counted back from `today` (decision 3). */
export function periodDays(period: EnergyCostPeriod, today: string): number {
  if (period === "today") return 1;
  if (period === "last_7_days") return 7;
  return Number(today.slice(8, 10));
}

/**
 * The zone the scope's day list is counted in (decision 2): the one zone every asset shares, or
 * else the organization's. A location or asset scope shares one zone by construction.
 */
export function scopeZone(assets: readonly CostScopeAsset[], organizationZone: string): string {
  const zones = new Set(assets.map((asset) => asset.zone));
  return zones.size === 1 ? [...zones][0]! : organizationZone;
}

const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * Fold hourly energy and the dated tariffs into one row per day of `days` (oldest first). Pure.
 * A bucket whose local day is not in `days` is ignored, so the caller may read a wider range.
 */
export function foldCostByDay(
  assets: readonly CostScopeAsset[],
  hours: readonly HourlyEnergy[],
  tariffs: TariffSeriesByAsset,
  days: readonly string[],
): EnergyCostDayRow[] {
  const currencies = new Set(assets.map((asset) => asset.currency));
  const currency = currencies.size === 1 ? (assets[0]?.currency ?? null) : null;
  const mixed = currencies.size > 1;

  const zoneOf = new Map(assets.map((asset) => [asset.assetId, asset.zone]));
  const acc = new Map<string, { kwh: number; cost: number; unpriced: boolean; buckets: number }>(
    days.map((day) => [day, { kwh: 0, cost: 0, unpriced: false, buckets: 0 }]),
  );
  for (const hour of hours) {
    const zone = zoneOf.get(hour.assetId);
    if (zone === undefined || !Number.isFinite(hour.kwh)) continue;
    const day = acc.get(localDay(hour.bucketMs, zone));
    if (day === undefined) continue;
    day.buckets += 1;
    day.kwh += hour.kwh;
    const rate = parameterValueAt(tariffs.get(hour.assetId) ?? [], hour.bucketMs);
    if (rate === undefined || !Number.isFinite(rate)) {
      // An hour with no energy costs nothing whatever the rate; one with energy and no rate
      // leaves the day unpriced rather than smaller.
      if (hour.kwh !== 0) day.unpriced = true;
      continue;
    }
    day.cost += hour.kwh * rate;
  }

  return days.map((day) => {
    const totals = acc.get(day)!;
    const kwh = totals.buckets === 0 ? null : round(totals.kwh, 3);
    const reason: EnergyCostReason | null = mixed
      ? "currency_mixed"
      : totals.buckets === 0
        ? "no_energy"
        : totals.unpriced
          ? "rate_missing"
          : null;
    return { day, kwh, cost: reason === null ? round(totals.cost, 2) : null, currency, reason };
  });
}

/** A window total over the daily rows (decision 5): the priced days summed, and how many there were. */
export interface CostTotal {
  readonly value: number | null;
  readonly currency: string | null;
  readonly coverage: { readonly fresh: number; readonly carrying: number };
  readonly reason: EnergyCostReason | null;
}

const REASON_PRECEDENCE: readonly EnergyCostReason[] = ["currency_mixed", "rate_missing", "no_energy"];

/** Sum the same rounded daily figures the chart draws, so a tile and its chart cannot disagree. */
export function sumCostDays(rows: readonly EnergyCostDayRow[]): CostTotal {
  const priced = rows.filter((row) => row.cost !== null);
  const coverage = { fresh: priced.length, carrying: rows.length };
  const currency = rows[0]?.currency ?? null;
  if (priced.length === 0) {
    // The strongest reason in the window, not the first day's: a month whose meter started on
    // day 3 with no rate is "rate_missing", not "no_energy".
    const reasons = new Set(rows.map((row) => row.reason));
    const reason = REASON_PRECEDENCE.find((candidate) => reasons.has(candidate)) ?? "no_energy";
    return { value: null, currency, coverage, reason };
  }
  const value = round(priced.reduce((sum, row) => sum + row.cost!, 0), 2);
  return { value, currency, coverage, reason: null };
}

// ---------------------------------------------------------------------------
// The database half
// ---------------------------------------------------------------------------

/** The one method of `CalcParametersService` this read needs. */
export interface TariffSeriesResolver {
  resolveSeriesForAssets(
    pairs: readonly { readonly assetId: string; readonly key: string }[],
    from: Date,
    to: Date,
  ): Promise<Map<string, ParameterSeriesRow[]>>;
}

interface ScopeAssetRow {
  readonly asset_id: string;
  readonly location_zone: string | null;
  readonly organization_zone: string | null;
  readonly currency: string | null;
}

interface HourRow {
  readonly asset_id: string;
  readonly bucket: Date | string;
  readonly kwh: number | string;
}

const HOUR_MS = 3_600_000;

/**
 * The part of the hour starting at `bucketMs` that has passed by `nowMs`: 1 for every closed
 * hour, the elapsed fraction for the hour still running. `avg(kW)` × hours = kWh, so the open
 * hour counts only the time that has passed, and "today" is the hours so far (decision 3).
 */
export function hourFraction(bucketMs: number, nowMs: number): number {
  return Math.min(1, Math.max(0, (nowMs - bucketMs) / HOUR_MS));
}

/** The most a zone is ahead of UTC (`+14:00`), plus a margin: the read range's slack. */
const ZONE_SLACK_MS = 15 * 3_600_000;

/**
 * The cost per local day for the assets in `assetIds`, for the days `daysFor(today)` names
 * counted back from today in the scope's zone. `pool` is the fleet pool; the `$1::uuid[]` scope —
 * the caller's resolved, organization-bounded readable asset ids — is the isolation control
 * (decision 7), as on `perAssetEnergy`. `resolveSeriesForAssets` keeps
 * `cp.organization_id = a.organization_id`, so no asset is priced at another organization's rate.
 */
export async function readEnergyCostByDay(
  pool: Pick<Pool, "query">,
  tariffs: TariffSeriesResolver,
  organizationId: string,
  assetIds: readonly string[],
  daysFor: (today: string) => number,
  now: Date,
): Promise<EnergyCostDayRow[]> {
  if (assetIds.length === 0) return [];
  const scope = await pool.query<ScopeAssetRow>(
    `
    SELECT a.id AS asset_id, l.timezone AS location_zone, o.timezone AS organization_zone, o.currency
      FROM bms.assets a
      LEFT JOIN bms.locations l ON l.id = a.location_id
      LEFT JOIN bms.organizations o ON o.id = a.organization_id
     WHERE a.id = ANY($1::uuid[])
       -- Defence in depth on the fleet pool (BYPASSRLS): the catalog already bounds the ids to
       -- the organization, and every later statement reads only the ids this one returns.
       AND a.organization_id = $2
    `,
    [[...assetIds], organizationId],
  );
  if (scope.rows.length === 0) return [];
  const assets: CostScopeAsset[] = scope.rows.map((row) => ({
    assetId: row.asset_id,
    zone: resolveSiteTimeZone(row.location_zone, row.organization_zone).arithmeticZone,
    currency: row.currency,
  }));
  const organization = await pool.query<{ timezone: string | null }>(
    "SELECT timezone FROM bms.organizations WHERE id = $1",
    [organizationId],
  );
  const organizationZone = resolveSiteTimeZone(null, organization.rows[0]?.timezone ?? null).arithmeticZone;

  const today = localDay(now.getTime(), scopeZone(assets, organizationZone));
  const days = windowDays(today, daysFor(today));
  const [first] = days as [string];
  const from = new Date(Date.parse(`${first}T00:00:00Z`) - ZONE_SLACK_MS);
  const to = now;

  // The `_5m` aggregate folded into LOCAL hours (the wall-clock hour in the asset's zone, with
  // its UTC offset so a repeated DST hour stays two hours), not the
  // `_1h` aggregate: `_1h` buckets are UTC hours, and in a zone with a half-hour offset
  // (Asia/Kolkata, +05:30) one UTC hour straddles local midnight. Five minutes divides every
  // zone offset in use, so a local hour is exact. `avgExpr` is the sample-weighted mean, the
  // correct form when several finer rows fold into one output bucket (`point-aggregates.ts`).
  const relation = aggregateRelation("5m");
  if (!relation) throw new Error("readEnergyCostByDay: no 5m aggregate relation");
  const hours = await pool.query<HourRow>(
    `
    SELECT asset_id, ((local_hour - utc_offset) AT TIME ZONE 'UTC') AS bucket, kwh
      FROM (
        SELECT p.asset_id,
               date_trunc('hour', p.bucket AT TIME ZONE z.zone) AS local_hour,
               -- The offset is part of the hour's identity: on a DST fall-back day the local
               -- 01:00 hour happens twice, once per offset, and each is its own hour.
               (p.bucket AT TIME ZONE z.zone) - (p.bucket AT TIME ZONE 'UTC') AS utc_offset,
               (${avgExpr("p")})::float8 AS kwh
          FROM ${relation} p
          JOIN unnest($1::uuid[], $2::text[]) AS z(asset_id, zone) ON z.asset_id = p.asset_id
         WHERE p.point_key = 'kw'
           AND p.bucket >= $3
           AND p.bucket <= $4
         GROUP BY 1, 2, 3
      ) hours
    `,
    [assets.map((asset) => asset.assetId), assets.map((asset) => asset.zone), from, to],
  );
  const energy: HourlyEnergy[] = hours.rows.map((row) => {
    const bucketMs = new Date(row.bucket).getTime();
    // `avg(kW)` over the local hour × the part of the hour that has passed = kWh.
    return { assetId: row.asset_id, bucketMs, kwh: Number(row.kwh) * hourFraction(bucketMs, now.getTime()) };
  });

  const withEnergy = [...new Set(energy.map((hour) => hour.assetId))];
  const series = await tariffs.resolveSeriesForAssets(
    withEnergy.map((assetId) => ({ assetId, key: ENERGY_TARIFF_KEY })),
    from,
    to,
  );
  const byAsset = new Map<string, readonly ParameterSeriesRow[]>();
  for (const assetId of withEnergy) {
    const rows = series.get(inputKey(assetId, ENERGY_TARIFF_KEY));
    if (rows !== undefined) byAsset.set(assetId, rows);
  }
  return foldCostByDay(assets, energy, byAsset, days);
}
