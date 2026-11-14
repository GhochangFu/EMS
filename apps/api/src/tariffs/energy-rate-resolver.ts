import type { BmsDb } from "@bms/db";
import type { Pool } from "pg";

import { inputKey } from "../calc/calc-batch";
import { parameterValueAt, type ParameterSeriesRow } from "../calc/calc-parameter-series";
import { CalcParametersService } from "../calc/calc-parameters.service";
import { ENERGY_TARIFF_KEY, type TariffResolver } from "../telemetry/energy-cost";
import { readLocalHourEnergy, type HourlyEnergy, type TariffSeriesResolver } from "../telemetry/energy-cost-by-day";
import { EnergyBillService, type BillComputation, type BillTarget } from "./energy-bill.service";
import { mappingInForce, readMappingsForAssets, type MappingRow } from "./location-tariff-read";
import { monthFirstDay, monthOf, monthWindow } from "./month-window";

/**
 * `F4.365` U7 (ADR 0134 decision 7, Amendment 1; plan D10, D12, Q3, Q4) — the
 * cost reads' tariff seam. It answers what `CalcParametersService` answers for
 * every pair but one kind: `energy_tariff_per_kwh` of an asset whose nearest
 * mapped location has a mapping **in force for the month** is the month's bill
 * rate, `bill.total ÷ the billing meter's kWh` over the same window (Q4: kWh,
 * also for a kVAh category).
 *
 * - **The month** is the one `at` falls in, in the location's zone. A month
 *   still running is the month-to-date bill with the fixed/demand charge
 *   prorated by the elapsed share of the month (Amendment 1); a complete month
 *   is its full bill (`elapsedShare` is 1 once the month is over).
 * - **Fail closed.** A mapped asset whose bill cannot be computed (no version,
 *   no reading, a falling register, no kVAh, a load-unit mismatch) or whose
 *   meter has no positive kWh is **absent** from the point map, so
 *   `energyCost` answers `null`. It never falls back to the flat parameter.
 * - **Unmapped** assets, and months a mapping does not cover, are the flat
 *   parameter exactly as before.
 * - **`verify`** is true when any priced asset's rate comes from a version
 *   whose data status is not `official` — the Indicative cost tile's badge
 *   (plan Q8).
 *
 * In the series ({@link EnergyRateResolver.resolveSeriesForAssets}) each mapped
 * month is one row `[month start, month end)` at `rank: -1`, placed before
 * the flat rows so `parameterValueAt` serves it first. An unpriced month's
 * row carries `Number.NaN`: `foldCostByDay` (`energy-cost-by-day.ts`) treats a
 * non-finite rate as no rate, so an hour with energy in that month leaves its
 * day `rate_missing` — the flat rows behind it are never reached.
 *
 * **A read over a range** ({@link EnergyRateResolver.resolveRangeRatesForAssets}; owner
 * ruling 2026-11-14) prices each local month at that month's own bill rate: a
 * mapped asset's energy is split by local hour (`readLocalHourEnergy`), each hour
 * is priced off the series above, and the asset's rate is the energy-weighted
 * blend — exactly the month's rate when every hour with energy falls in one
 * month. A report ending on a month's last local day is therefore that month's
 * full bill, not the next month's. Unmapped assets stay the flat parameter at
 * the range's end, exactly as the point read.
 *
 * Reads run on the fleet pool (plan D12); the organization equality lives in
 * each reader (`location-tariff-read.ts`, `tariff-versions.ts`,
 * `calc-parameters.service.ts`).
 */

type Pair = { readonly assetId: string; readonly key: string };

export type FlatParameters = Pick<CalcParametersService, "resolveForAssets" | "resolveSeriesForAssets">;
export type MappingReader = (assetIds: readonly string[]) => Promise<Map<string, MappingRow[]>>;
export type BillReader = Pick<EnergyBillService, "computeBills">;
/** Mean kW per asset per local hour over `[from, to]` (`readLocalHourEnergy`). */
export type HourReader = (
  assets: readonly { readonly assetId: string; readonly zone: string }[],
  from: Date,
  to: Date,
) => Promise<HourlyEnergy[]>;

/** The series rank of a mapped month: before every flat row (asset rows are 0). */
export const MAPPED_MONTH_RANK = -1;

interface Priced {
  readonly rate: number | null;
  readonly verify: boolean;
}

/** One mapped month of one asset: `[fromMs, toMs)` at its bill rate (`null`: unpriced). */
interface MonthRate {
  readonly fromMs: number;
  readonly toMs: number;
  readonly rate: number | null;
  readonly verify: boolean;
}

function monthSeriesRow(month: MonthRate): ParameterSeriesRow {
  return {
    fromMs: month.fromMs,
    toMs: month.toMs,
    value: month.rate === null ? Number.NaN : month.rate,
    rank: MAPPED_MONTH_RANK,
  };
}

/**
 * One mapped asset's rate over a range (owner ruling 2026-11-14): every hour
 * with energy priced at the rate the series serves for it — its month's bill
 * rate, or the flat row in a month no mapping covers — blended by energy.
 * Exactly the one rate when every hour with energy has the same one, so a
 * range inside one month is that month's rate to the last bit. `null` (fail
 * closed) when an hour with energy has no finite rate. With no energy at all
 * the cost is zero whatever the rate: the latest priced month's rate stands in.
 * Pure.
 */
export function blendRangeRate(
  hours: readonly HourlyEnergy[],
  months: readonly MonthRate[],
  flat: readonly ParameterSeriesRow[],
): { rate: number | null; verify: boolean } {
  const series = [...months.map(monthSeriesRow), ...flat];
  let kwh = 0;
  let cost = 0;
  let verify = false;
  const rates = new Set<number>();
  for (const hour of hours) {
    if (!Number.isFinite(hour.kwh) || hour.kwh === 0) continue;
    const rate = parameterValueAt(series, hour.bucketMs);
    if (rate === undefined || !Number.isFinite(rate)) return { rate: null, verify: false };
    const month = months.find((m) => m.fromMs <= hour.bucketMs && hour.bucketMs < m.toMs);
    verify ||= month?.verify === true;
    kwh += hour.kwh;
    cost += hour.kwh * rate;
    rates.add(rate);
  }
  if (rates.size === 1) return { rate: [...rates][0]!, verify };
  if (rates.size > 1) return kwh === 0 ? { rate: null, verify: false } : { rate: cost / kwh, verify };
  const latest = [...months].reverse().find((m) => m.rate !== null);
  return latest === undefined ? { rate: null, verify: false } : { rate: latest.rate, verify: latest.verify };
}

/** `bill.total ÷ kwh`, or `null` when the bill failed or the meter has no positive kWh. */
export function billRate(bill: BillComputation): Priced {
  if (!bill.ok || bill.kwh === null || !(bill.kwh > 0)) return { rate: null, verify: false };
  return { rate: bill.bill.total / bill.kwh, verify: bill.version.dataStatus !== "official" };
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Months `first..last` inclusive (`YYYY-MM` sorts as text). */
function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = first; m <= last; m = nextMonth(m)) out.push(m);
  return out;
}

export class EnergyRateResolver implements TariffResolver, TariffSeriesResolver {
  constructor(
    private readonly flat: FlatParameters,
    private readonly mappings: MappingReader,
    private readonly bills: BillReader,
    private readonly clock: () => Date = () => new Date(),
    private readonly hours: HourReader = async () => {
      throw new Error("EnergyRateResolver: no hourly energy reader for a range read");
    },
  ) {}

  /** `CalcParametersService.resolveForAssets`'s contract, keyed by `inputKey`. */
  async resolveForAssets(pairs: readonly Pair[], at: Date): Promise<Map<string, number>> {
    return (await this.resolvePoint(pairs, at)).values;
  }

  /** The tariff per asset id for `energyCost`, and whether any priced rate needs verifying. */
  async resolveRatesForAssets(
    assetIds: readonly string[],
    at: Date,
  ): Promise<{ rates: Map<string, number>; verify: boolean }> {
    const { values, verify } = await this.resolvePoint(
      assetIds.map((assetId) => ({ assetId, key: ENERGY_TARIFF_KEY })),
      at,
    );
    const rates = new Map<string, number>();
    for (const assetId of assetIds) {
      const value = values.get(inputKey(assetId, ENERGY_TARIFF_KEY));
      if (value !== undefined) rates.set(assetId, value);
    }
    return { rates, verify };
  }

  /**
   * The tariff per asset id for a read over `[start, end]` (owner ruling
   * 2026-11-14): a mapped asset at each local month's own bill rate, blended
   * by its energy ({@link blendRangeRate}); an asset no month of the range is
   * mapped for at the flat parameter in force at `end`, as before.
   */
  async resolveRangeRatesForAssets(
    assetIds: readonly string[],
    start: Date,
    end: Date,
  ): Promise<{ rates: Map<string, number>; verify: boolean }> {
    const pairs = assetIds.map((assetId) => ({ assetId, key: ENERGY_TARIFF_KEY }));
    const { months, zones } = await this.monthRates(pairs, start, end);
    const unmapped = assetIds.filter((assetId) => !months.has(assetId));
    const rates = new Map<string, number>();
    let verify = false;
    if (unmapped.length > 0) {
      const flat = await this.flat.resolveForAssets(
        unmapped.map((assetId) => ({ assetId, key: ENERGY_TARIFF_KEY })),
        end,
      );
      for (const assetId of unmapped) {
        const value = flat.get(inputKey(assetId, ENERGY_TARIFF_KEY));
        if (value !== undefined) rates.set(assetId, value);
      }
    }
    const mapped = [...months.keys()];
    if (mapped.length > 0) {
      const hours = await this.hours(
        mapped.map((assetId) => ({ assetId, zone: zones.get(assetId)! })),
        start,
        end,
      );
      const flatSeries = await this.flat.resolveSeriesForAssets(
        mapped.map((assetId) => ({ assetId, key: ENERGY_TARIFF_KEY })),
        start,
        end,
      );
      for (const assetId of mapped) {
        const blended = blendRangeRate(
          hours.filter((hour) => hour.assetId === assetId),
          months.get(assetId)!,
          flatSeries.get(inputKey(assetId, ENERGY_TARIFF_KEY)) ?? [],
        );
        if (blended.rate === null) continue; // fail closed: absent, never the flat parameter
        rates.set(assetId, blended.rate);
        verify ||= blended.verify;
      }
    }
    return { rates, verify };
  }

  /** `CalcParametersService.resolveSeriesForAssets`'s contract, with each mapped month first. */
  async resolveSeriesForAssets(pairs: readonly Pair[], from: Date, to: Date): Promise<Map<string, ParameterSeriesRow[]>> {
    const { months } = await this.monthRates(pairs, from, to);
    const out = await this.flat.resolveSeriesForAssets(pairs, from, to);
    for (const [assetId, rows] of months) {
      const key = inputKey(assetId, ENERGY_TARIFF_KEY);
      out.set(key, [...rows.map(monthSeriesRow), ...(out.get(key) ?? [])]);
    }
    return out;
  }

  private async resolvePoint(pairs: readonly Pair[], at: Date): Promise<{ values: Map<string, number>; verify: boolean }> {
    const tariffAssets = [...new Set(pairs.filter((p) => p.key === ENERGY_TARIFF_KEY).map((p) => p.assetId))];
    const byAsset = await this.mappings(tariffAssets);
    const assigned = new Map<string, BillTarget>();
    const targets = new Map<string, BillTarget>();
    for (const assetId of tariffAssets) {
      const list = byAsset.get(assetId);
      if (list === undefined || list.length === 0) continue;
      const month = monthOf(at, list[0]!.zone);
      const mapping = mappingInForce(list, monthFirstDay(month));
      if (mapping === null) continue;
      const id = `${mapping.id}|${month}`;
      const target = targets.get(id) ?? { mapping, month, prorateFixed: true };
      targets.set(id, target);
      assigned.set(assetId, target);
    }
    const priced = await this.price([...targets.values()]);

    const flatPairs = pairs.filter((p) => !(p.key === ENERGY_TARIFF_KEY && assigned.has(p.assetId)));
    const values = flatPairs.length === 0 ? new Map<string, number>() : await this.flat.resolveForAssets(flatPairs, at);
    let verify = false;
    for (const [assetId, target] of assigned) {
      const p = priced.get(target)!;
      if (p.rate === null) continue; // fail closed: absent, never the flat parameter
      values.set(inputKey(assetId, ENERGY_TARIFF_KEY), p.rate);
      verify ||= p.verify;
    }
    return { values, verify };
  }

  /** Each asset's mapped months over `[from, to]` in its location's zone, priced, and that zone. */
  private async monthRates(
    pairs: readonly Pair[],
    from: Date,
    to: Date,
  ): Promise<{ months: Map<string, MonthRate[]>; zones: Map<string, string> }> {
    const tariffAssets = [...new Set(pairs.filter((p) => p.key === ENERGY_TARIFF_KEY).map((p) => p.assetId))];
    const byAsset = await this.mappings(tariffAssets);
    const targets = new Map<string, BillTarget>();
    const perAsset = new Map<string, BillTarget[]>();
    const zones = new Map<string, string>();
    for (const assetId of tariffAssets) {
      const list = byAsset.get(assetId);
      if (list === undefined || list.length === 0) continue;
      const zone = list[0]!.zone;
      const months = monthsBetween(monthOf(from, zone), monthOf(to, zone));
      const mine: BillTarget[] = [];
      for (const month of months) {
        const mapping = mappingInForce(list, monthFirstDay(month));
        if (mapping === null) continue;
        const id = `${mapping.id}|${month}`;
        const target = targets.get(id) ?? { mapping, month, prorateFixed: true };
        targets.set(id, target);
        mine.push(target);
      }
      if (mine.length > 0) {
        perAsset.set(assetId, mine);
        zones.set(assetId, zone);
      }
    }
    const priced = await this.price([...targets.values()]);
    const months = new Map<string, MonthRate[]>();
    for (const [assetId, mine] of perAsset) {
      months.set(
        assetId,
        mine.map((target) => {
          const window = monthWindow(target.month, target.mapping.zone);
          const p = priced.get(target)!;
          return { fromMs: window.start.getTime(), toMs: window.end.getTime(), rate: p.rate, verify: p.verify };
        }),
      );
    }
    return { months, zones };
  }

  private async price(targets: readonly BillTarget[]): Promise<Map<BillTarget, Priced>> {
    const out = new Map<BillTarget, Priced>();
    if (targets.length === 0) return out;
    const bills = await this.bills.computeBills(targets, this.clock());
    targets.forEach((target, i) => out.set(target, billRate(bills[i]!)));
    return out;
  }
}

/** The production wiring: the flat parameters and the bill both on the fleet connection. */
export function createEnergyRateResolver(fleetDb: BmsDb, pool: Pick<Pool, "query">): EnergyRateResolver {
  return new EnergyRateResolver(
    new CalcParametersService(fleetDb),
    (assetIds) => readMappingsForAssets(pool, assetIds),
    new EnergyBillService(pool),
    () => new Date(),
    (assets, from, to) => readLocalHourEnergy(pool, assets, from, to),
  );
}
