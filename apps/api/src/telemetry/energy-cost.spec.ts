import { inputKey } from "../calc/calc-batch";
import { ENERGY_TARIFF_KEY, energyCost, resolveTariffs, type PerAssetEnergy, type TariffResolver } from "./energy-cost";

/**
 * `E4.1c` — the pure half of the indicative-cost read (ADR 0070 decision 7).
 * Everything here is arithmetic; the two database halves — the per-asset
 * statement in `DashboardService.energySummary` and in
 * `ReportsService.energySummary` — are asserted in
 * `energy-cost.integration.spec.ts`.
 *
 * The three fail-closed rules this file exists to hold (plan §3, design
 * decision 2; the owner's Q4 ruling of 2026-09-19):
 *
 * - `currency` is the one distinct currency of the rows, else `null`.
 * - `tariffPerKwh` is the one distinct resolved tariff when **every** row
 *   resolved, else `null`.
 * - `indicativeCost` is Σ `kwh_i × tariff_i` (2 dp) when every row resolved
 *   **and** `currency` is non-null, else `null`.
 *
 * A partial sum understates and a sum across two currencies is not a number —
 * both are decision 2's rule at the read: `null`, never `0`. The `absentTariff`
 * case is the one the `?? 0` mutation reddens.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const A1 = "a1";
const A2 = "a2";

function rows(...entries: readonly (readonly [string, number, string | null])[]): PerAssetEnergy[] {
  return entries.map(([assetId, kwh, currency]) => ({ assetId, kwh, currency, locationId: "l1" }));
}

function tariffs(entries: Record<string, number>): ReadonlyMap<string, number> {
  return new Map(Object.entries(entries));
}

/** C1 — two assets, one currency, both tariffs the same → the sum, the tariff, the currency. */
export function assertOneCurrencyOneTariffSums(): void {
  const result = energyCost(rows([A1, 100, "ZAR"], [A2, 50, "ZAR"]), tariffs({ [A1]: 2.15, [A2]: 2.15 }));
  assert(result.indicativeCost === 322.5, `expected 322.5, got ${String(result.indicativeCost)}`);
  assert(result.tariffPerKwh === 2.15, `expected tariff 2.15, got ${String(result.tariffPerKwh)}`);
  assert(result.currency === "ZAR", `expected ZAR, got ${String(result.currency)}`);
}

/** C2 — one asset without a tariff → cost null, tariff null; the currency is still known. */
export function assertAbsentTariffIsNullNotZero(): void {
  const result = energyCost(rows([A1, 100, "ZAR"], [A2, 50, "ZAR"]), tariffs({ [A1]: 2.15 }));
  assert(result.indicativeCost === null, `a partial sum understates — expected null, got ${String(result.indicativeCost)}`);
  assert(result.tariffPerKwh === null, `expected tariff null, got ${String(result.tariffPerKwh)}`);
  assert(result.currency === "ZAR", `the currency is a property of the rows — expected ZAR, got ${String(result.currency)}`);
}

/** C3 — two currencies with every tariff present → all three null. The load-bearing claim. */
export function assertMixedCurrencyIsNull(): void {
  const result = energyCost(rows([A1, 100, "ZAR"], [A2, 50, "INR"]), tariffs({ [A1]: 2.15, [A2]: 8 }));
  assert(result.currency === null, `two currencies is no currency — got ${String(result.currency)}`);
  assert(result.indicativeCost === null, `a sum across two currencies is not a number — got ${String(result.indicativeCost)}`);
  assert(result.tariffPerKwh === null, `expected tariff null, got ${String(result.tariffPerKwh)}`);
}

/** C4 — two different tariffs, one currency → the per-asset sum, but no single tariff. */
export function assertTwoTariffsSumPerAsset(): void {
  const result = energyCost(rows([A1, 100, "ZAR"], [A2, 50, "ZAR"]), tariffs({ [A1]: 3, [A2]: 2.15 }));
  assert(result.indicativeCost === 407.5, `expected 100×3 + 50×2.15 = 407.5, got ${String(result.indicativeCost)}`);
  assert(result.tariffPerKwh === null, `two tariffs is no single tariff — got ${String(result.tariffPerKwh)}`);
  assert(result.currency === "ZAR", `expected ZAR, got ${String(result.currency)}`);
}

/** C5 — no rows (an empty scope) → all null. */
export function assertNoRowsIsNull(): void {
  const result = energyCost([], tariffs({ [A1]: 2.15 }));
  assert(result.indicativeCost === null, `expected null, got ${String(result.indicativeCost)}`);
  assert(result.tariffPerKwh === null, `expected null, got ${String(result.tariffPerKwh)}`);
  assert(result.currency === null, `expected null, got ${String(result.currency)}`);
}

/** C6 — the cost is rounded to two decimals, the ribbon's convention. */
export function assertRoundsToTwoDecimals(): void {
  const result = energyCost(rows([A1, 1.234, "ZAR"]), tariffs({ [A1]: 2.15 }));
  // 1.234 × 2.15 = 2.6531
  assert(result.indicativeCost === 2.65, `expected 2.65, got ${String(result.indicativeCost)}`);
}

/** C7 — a map entry for an asset not in the rows is ignored, and does not make a tariff "distinct". */
export function assertStrayTariffIsIgnored(): void {
  const result = energyCost(rows([A1, 100, "ZAR"]), tariffs({ [A1]: 2.15, stray: 99 }));
  assert(result.indicativeCost === 215, `expected 215, got ${String(result.indicativeCost)}`);
  assert(result.tariffPerKwh === 2.15, `the stray entry must not count — got ${String(result.tariffPerKwh)}`);
}

/** C8 — a non-finite kWh (a `NaN` from a bad cast) fails closed rather than writing `NaN` into the contract. */
export function assertNonFiniteKwhIsNull(): void {
  const result = energyCost(rows([A1, Number.NaN, "ZAR"]), tariffs({ [A1]: 2.15 }));
  assert(result.indicativeCost === null, `expected null for a NaN input, got ${String(result.indicativeCost)}`);
}

/** C9 — the same tariff in two currencies is still no single tariff: `Tariff,2.15,` with an empty unit would be a number with no meaning. */
export function assertEqualTariffsInTwoCurrenciesIsNull(): void {
  const result = energyCost(rows([A1, 100, "ZAR"], [A2, 50, "INR"]), tariffs({ [A1]: 2.15, [A2]: 2.15 }));
  assert(result.currency === null, `two currencies is no currency — got ${String(result.currency)}`);
  assert(result.tariffPerKwh === null, `one number across two currencies is not a tariff — got ${String(result.tariffPerKwh)}`);
  assert(result.indicativeCost === null, `expected null, got ${String(result.indicativeCost)}`);
}

/**
 * C10 — a row with `currency: null` and a tariff nobody could resolve; the
 * whole read fails closed. Until `F4.159` the per-asset read produced such a
 * row for orphan telemetry (an `asset_id` with no `bms.assets` row); it now
 * leaves those out, and this holds the reducer's own rule. Both halves are
 * asserted: with the tariff absent and, as the control on rule 1 alone, with a
 * tariff somehow present.
 */
export function assertOrphanTelemetryIsNull(): void {
  const absent = energyCost(rows([A1, 100, "ZAR"], ["orphan", 5, null]), tariffs({ [A1]: 2.15 }));
  assert(absent.indicativeCost === null, `an unpriced row fails the read closed — got ${String(absent.indicativeCost)}`);
  const present = energyCost(rows([A1, 100, "ZAR"], ["orphan", 5, null]), tariffs({ [A1]: 2.15, orphan: 2.15 }));
  assert(present.currency === null, `a null currency beside ZAR is no currency — got ${String(present.currency)}`);
  assert(present.indicativeCost === null, `expected null, got ${String(present.indicativeCost)}`);
  const alone = energyCost(rows(["orphan", 5, null]), tariffs({ orphan: 2.15 }));
  assert(alone.currency === null && alone.indicativeCost === null, "a null currency alone is not a currency");
}

/**
 * C11 — `F4.365` U7 (plan Q8): `tariffVerify` carries the resolver's flag only
 * with a cost. A `null` cost has nothing to verify; no flag defaults to false.
 */
export function assertTariffVerifyNeedsACost(): void {
  const priced = energyCost(rows([A1, 100, "INR"]), tariffs({ [A1]: 10 }), true);
  assert(priced.tariffVerify === true && priced.indicativeCost === 1000, `expected a verified 1000, got ${JSON.stringify(priced)}`);
  const unpriced = energyCost(rows([A1, 100, "INR"], [A2, 5, "INR"]), tariffs({ [A1]: 10 }), true);
  assert(unpriced.indicativeCost === null && unpriced.tariffVerify === false, `a null cost carries no flag, got ${JSON.stringify(unpriced)}`);
  const empty = energyCost([], tariffs({}), true);
  assert(empty.tariffVerify === false, "an empty scope carries no flag");
  const plain = energyCost(rows([A1, 100, "INR"]), tariffs({ [A1]: 10 }));
  assert(plain.tariffVerify === false, "no flag by default");
}

/**
 * C12 — `resolveTariffs` reads `resolveRatesForAssets` when the resolver has it
 * (the `EnergyRateResolver`), and keys `resolveForAssets` by asset with
 * `verify: false` when it does not (`CalcParametersService`, every fake).
 */
export async function assertResolveTariffsPrefersTheRateMethod(): Promise<void> {
  const scope = rows([A1, 100, "INR"], [A2, 5, "INR"]);
  const flat: TariffResolver = {
    async resolveForAssets(pairs) {
      return new Map(pairs.filter((p) => p.assetId === A1).map((p) => [inputKey(p.assetId, ENERGY_TARIFF_KEY), 7]));
    },
  };
  const a = await resolveTariffs(flat, scope, new Date());
  assert(a.verify === false && a.rates.get(A1) === 7 && !a.rates.has(A2), JSON.stringify([...a.rates]));
  const asked: string[][] = [];
  const slab: TariffResolver = {
    ...flat,
    async resolveRatesForAssets(assetIds) {
      asked.push([...assetIds]);
      return { rates: new Map([[A2, 9]]), verify: true };
    },
  };
  const b = await resolveTariffs(slab, scope, new Date());
  assert(b.verify === true && b.rates.get(A2) === 9 && !b.rates.has(A1), JSON.stringify([...b.rates]));
  assert(JSON.stringify(asked) === JSON.stringify([[A1, A2]]), `asked by asset id: ${JSON.stringify(asked)}`);
}

/** `F4.365` (owner ruling 2026-11-14): with a range, `resolveTariffs` asks the range method, with the range. */
export async function assertResolveTariffsPricesARangeByRange(): Promise<void> {
  const scope = rows([A1, 100, "INR"], [A2, 5, "INR"]);
  const asked: { ids: string[]; start: Date; end: Date }[] = [];
  const resolver: TariffResolver = {
    async resolveForAssets() {
      throw new Error("the point read must not be asked for a range");
    },
    async resolveRatesForAssets() {
      throw new Error("the point rate must not be asked for a range");
    },
    async resolveRangeRatesForAssets(assetIds, start, end) {
      asked.push({ ids: [...assetIds], start, end });
      return { rates: new Map([[A1, 3]]), verify: true };
    },
  };
  const start = new Date("2026-10-01T00:00:00.000Z");
  const end = new Date("2026-10-31T23:59:59.999Z");
  const r = await resolveTariffs(resolver, scope, end, { start, end });
  assert(r.verify === true && r.rates.get(A1) === 3 && !r.rates.has(A2), JSON.stringify([...r.rates]));
  assert(asked.length === 1 && asked[0]!.start === start && asked[0]!.end === end, "asked once, with the range");
  assert(JSON.stringify(asked[0]!.ids) === JSON.stringify([A1, A2]), `asked by asset id: ${JSON.stringify(asked[0]!.ids)}`);
}
