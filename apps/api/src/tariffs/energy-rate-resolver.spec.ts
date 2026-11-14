import type { ComputedBill } from "@bms/shared";

import { inputKey } from "../calc/calc-batch";
import { ORGANIZATION_RANK, parameterValueAt, type ParameterSeriesRow } from "../calc/calc-parameter-series";
import { ENERGY_TARIFF_KEY } from "../telemetry/energy-cost";
import type { BillComputation, BillTarget } from "./energy-bill.service";
import type { HourlyEnergy } from "../telemetry/energy-cost-by-day";
import { blendRangeRate, EnergyRateResolver, MAPPED_MONTH_RANK, type FlatParameters } from "./energy-rate-resolver";
import type { MappingRow } from "./location-tariff-read";
import { monthWindow } from "./month-window";
import type { TariffVersion } from "./tariff-versions";

/**
 * `F4.365` U7 — `EnergyRateResolver` against stubbed mapping, bill and flat
 * readers (plan U7 step 1; ADR 0134 decision 7, Amendment 1; plan D10, Q3, Q4).
 * The database halves are `energy-rate-resolver.integration.spec.ts`. Vitest
 * entry point: the sibling `.test.ts` (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const KOLKATA = "Asia/Kolkata";
const FLAT = 8;
/** 2026-10-15 12:00 IST — inside October in Kolkata. */
const AT = new Date("2026-10-15T06:30:00.000Z");
const NOW = new Date("2026-10-20T00:00:00.000Z");

function mapping(id: string, from = "2026-01-01", to: string | null = null): MappingRow {
  return {
    id,
    organizationId: "org-a",
    locationId: `loc-${id}`,
    tariffKey: "LINE",
    billingMeterAssetId: `meter-${id}`,
    sanctionedLoad: 3,
    sanctionedLoadUnit: "kw",
    effectiveFrom: from,
    effectiveTo: to,
    zone: KOLKATA,
    timeZone: KOLKATA,
    currency: "INR",
  };
}

const MAPPINGS: Record<string, MappingRow[]> = {
  priced: [mapping("m-priced")],
  priced2: [mapping("m-priced")],
  unpriced: [mapping("m-unpriced")],
  secondary: [mapping("m-secondary")],
  zeroKwh: [mapping("m-zero")],
  // Mapped only from November: October is the flat parameter's.
  later: [mapping("m-later", "2026-11-01")],
  // September's bill fails, October's is priced.
  half: [mapping("m-half")],
};

const window = monthWindow("2026-10", KOLKATA);

function ok(total: number, kwh: number | null, dataStatus: TariffVersion["dataStatus"] = "official"): BillComputation {
  return {
    ok: true,
    window,
    complete: false,
    version: { dataStatus } as TariffVersion,
    units: 250,
    unitType: "kwh",
    estimated: false,
    kwh,
    bill: { total } as ComputedBill,
  };
}

function billFor(target: BillTarget): BillComputation {
  switch (target.mapping.id) {
    case "m-priced":
      return target.month === "2026-09" ? ok(5000, 400) : ok(2546, 250);
    case "m-secondary":
      return ok(5392.5, 600, "secondary");
    case "m-zero":
      return ok(150, 0);
    case "m-later":
      return ok(1000, 100);
    case "m-half":
      return target.month === "2026-10" ? ok(2546, 250) : { ok: false, window, complete: true, version: null, reason: "meter_no_reading" };
    default:
      return { ok: false, window, complete: false, version: null, reason: "meter_no_reading" };
  }
}

interface Harness {
  resolver: EnergyRateResolver;
  flatPointPairs: { assetId: string; key: string }[][];
  billCalls: { targets: BillTarget[]; now: Date }[];
  flatPointAt: Date[];
}

function harness(hours: readonly HourlyEnergy[] = []): Harness {
  const flatPointAt: Date[] = [];
  const flatPointPairs: Harness["flatPointPairs"] = [];
  const billCalls: Harness["billCalls"] = [];
  const flat: FlatParameters = {
    async resolveForAssets(pairs, at) {
      flatPointPairs.push(pairs.map((p) => ({ ...p })));
      flatPointAt.push(at);
      return new Map(pairs.map((p) => [inputKey(p.assetId, p.key), FLAT]));
    },
    async resolveSeriesForAssets(pairs) {
      return new Map(pairs.map((p) => [inputKey(p.assetId, p.key), [{ fromMs: 0, toMs: null, value: FLAT, rank: ORGANIZATION_RANK }]]));
    },
  };
  const resolver = new EnergyRateResolver(
    flat,
    async (assetIds) => new Map(assetIds.filter((id) => MAPPINGS[id] !== undefined).map((id) => [id, MAPPINGS[id]!])),
    {
      async computeBills(targets, now) {
        billCalls.push({ targets: [...targets], now });
        return targets.map(billFor);
      },
    },
    () => NOW,
    async (assets, from, to) =>
      hours.filter(
        (h) => assets.some((a) => a.assetId === h.assetId && a.zone === KOLKATA) && h.bucketMs >= from.getTime() && h.bucketMs <= to.getTime(),
      ),
  );
  return { resolver, flatPointPairs, billCalls, flatPointAt };
}

const tariff = (assetId: string) => ({ assetId, key: ENERGY_TARIFF_KEY });

/** An unmapped asset is the flat parameter, asked of `CalcParametersService` unchanged. */
export async function assertAnUnmappedAssetDelegates(): Promise<void> {
  const h = harness();
  const out = await h.resolver.resolveForAssets([tariff("plain")], AT);
  assert(out.get(inputKey("plain", ENERGY_TARIFF_KEY)) === FLAT, `expected the flat ${FLAT}, got ${String(out.get(inputKey("plain", ENERGY_TARIFF_KEY)))}`);
  assert(JSON.stringify(h.flatPointPairs) === JSON.stringify([[tariff("plain")]]), JSON.stringify(h.flatPointPairs));
  assert(h.billCalls.length === 0, "no bill is computed for an unmapped asset");
}

/** A mapped asset is the month's bill total ÷ the meter's kWh (Q4), month-to-date with the fixed charge prorated (Amendment 1). */
export async function assertAMappedAssetIsTheBillRate(): Promise<void> {
  const h = harness();
  const out = await h.resolver.resolveForAssets([tariff("priced")], AT);
  const rate = out.get(inputKey("priced", ENERGY_TARIFF_KEY));
  assert(rate === 2546 / 250, `expected 2546 ÷ 250, got ${String(rate)}`);
  assert(h.billCalls.length === 1, "one bill read");
  const [call] = h.billCalls;
  assert(call!.now === NOW, "the bill is computed at the clock's now");
  assert(call!.targets.length === 1 && call!.targets[0]!.month === "2026-10", `the month of 'at' in the zone: ${JSON.stringify(call!.targets)}`);
  assert(call!.targets[0]!.prorateFixed === true, "the live rate prorates the fixed charge (Amendment 1)");
  assert(h.flatPointPairs.every((pairs) => pairs.every((p) => p.assetId !== "priced")), "the flat resolver is not asked for a mapped asset");
}

/** Two assets under one mapping share one bill. */
export async function assertOneBillPerMappingMonth(): Promise<void> {
  const h = harness();
  const out = await h.resolver.resolveForAssets([tariff("priced"), tariff("priced2")], AT);
  assert(h.billCalls[0]!.targets.length === 1, `one target, got ${h.billCalls[0]!.targets.length}`);
  assert(out.get(inputKey("priced2", ENERGY_TARIFF_KEY)) === 2546 / 250, "both assets are priced");
}

/** A mapped asset with no computable bill is absent — never the flat parameter (D10). */
export async function assertAnUnpricedMappedAssetDoesNotFallBack(): Promise<void> {
  const h = harness();
  const out = await h.resolver.resolveForAssets([tariff("unpriced"), tariff("zeroKwh"), tariff("plain")], AT);
  assert(!out.has(inputKey("unpriced", ENERGY_TARIFF_KEY)), `a failed bill is absent, got ${String(out.get(inputKey("unpriced", ENERGY_TARIFF_KEY)))}`);
  assert(!out.has(inputKey("zeroKwh", ENERGY_TARIFF_KEY)), `no positive kWh is absent, got ${String(out.get(inputKey("zeroKwh", ENERGY_TARIFF_KEY)))}`);
  assert(out.get(inputKey("plain", ENERGY_TARIFF_KEY)) === FLAT, "the unmapped neighbour is still priced");
  const { rates } = await h.resolver.resolveRatesForAssets(["unpriced"], AT);
  assert(rates.size === 0, `resolveRatesForAssets is absent too, got ${JSON.stringify([...rates])}`);
}

/** A month the mapping does not cover is the flat parameter's. */
export async function assertAMonthBeforeTheMappingIsFlat(): Promise<void> {
  const h = harness();
  const out = await h.resolver.resolveForAssets([tariff("later")], AT);
  assert(out.get(inputKey("later", ENERGY_TARIFF_KEY)) === FLAT, `expected flat before the mapping, got ${String(out.get(inputKey("later", ENERGY_TARIFF_KEY)))}`);
}

/** A key other than the tariff passes through to the flat resolver, even for a mapped asset. */
export async function assertOtherKeysPassThrough(): Promise<void> {
  const h = harness();
  const out = await h.resolver.resolveForAssets([{ assetId: "priced", key: "pue_design" }], AT);
  assert(out.get(inputKey("priced", "pue_design")) === FLAT, "a non-tariff key is the flat resolver's");
  assert(h.billCalls.length === 0, "no bill for a non-tariff key");
}

/** `verify` is true when a priced rate comes from a non-`official` version, by asset id. */
export async function assertVerifyFollowsTheDataStatus(): Promise<void> {
  const h = harness();
  const secondary = await h.resolver.resolveRatesForAssets(["secondary", "plain"], AT);
  assert(secondary.verify, "a secondary version needs verifying");
  assert(secondary.rates.get("secondary") === 5392.5 / 600 && secondary.rates.get("plain") === FLAT, JSON.stringify([...secondary.rates]));
  const official = await h.resolver.resolveRatesForAssets(["priced", "plain"], AT);
  assert(!official.verify, "an official version needs no badge");
  const none = await h.resolver.resolveRatesForAssets(["plain"], AT);
  assert(!none.verify, "the flat parameter needs no badge");
}

/** The series: each mapped month first at rank -1 over its local month; an unpriced month is NaN; the flat rows follow. */
export async function assertTheSeriesPutsMappedMonthsFirst(): Promise<void> {
  const h = harness();
  const from = new Date("2026-09-10T00:00:00.000Z");
  const to = new Date("2026-10-15T00:00:00.000Z");
  const out = await h.resolver.resolveSeriesForAssets([tariff("priced"), tariff("unpriced"), tariff("plain"), tariff("later")], from, to);
  const priced = out.get(inputKey("priced", ENERGY_TARIFF_KEY)) as ParameterSeriesRow[];
  const sep = monthWindow("2026-09", KOLKATA);
  assert(priced.length === 3, `two mapped months and the flat row, got ${JSON.stringify(priced)}`);
  assert(priced[0]!.rank === MAPPED_MONTH_RANK && priced[0]!.fromMs === sep.start.getTime() && priced[0]!.toMs === sep.end.getTime(), JSON.stringify(priced[0]));
  assert(priced[0]!.value === 5000 / 400 && priced[1]!.value === 2546 / 250, "September's full bill, October's month to date");
  assert(priced[2]!.rank === ORGANIZATION_RANK, "the flat row comes last");
  assert(parameterValueAt(priced, window.start.getTime() + 3_600_000) === 2546 / 250, "parameterValueAt serves the mapped month");

  const unpriced = out.get(inputKey("unpriced", ENERGY_TARIFF_KEY)) as ParameterSeriesRow[];
  const served = parameterValueAt(unpriced, window.start.getTime() + 3_600_000);
  assert(served !== undefined && Number.isNaN(served), `an unpriced month is NaN, never the flat ${FLAT}: got ${String(served)}`);

  const plain = out.get(inputKey("plain", ENERGY_TARIFF_KEY)) as ParameterSeriesRow[];
  assert(plain.length === 1 && plain[0]!.value === FLAT, "an unmapped asset's series is the flat one");
  const later = out.get(inputKey("later", ENERGY_TARIFF_KEY)) as ParameterSeriesRow[];
  assert(later.length === 1 && later[0]!.value === FLAT, "months before the mapping are flat");
  const targets = h.billCalls.flatMap((c) => c.targets);
  assert(targets.every((t) => t.prorateFixed === true), "the series prorates too (a complete month's share is 1)");
}


// ---------------------------------------------------------------------------
// A read over a range (owner ruling 2026-11-14): each local month at its own bill rate.
// ---------------------------------------------------------------------------

const SEP_RATE = 5000 / 400;
const OCT_RATE = 2546 / 250;
const hour = (assetId: string, iso: string, kwh: number): HourlyEnergy => ({ assetId, bucketMs: Date.parse(iso), kwh });
/** A report for the UTC dates 2026-09-29..30: it ends at 2026-10-01 05:29:59 in Kolkata. */
const SEP_END = { start: new Date("2026-09-29T00:00:00.000Z"), end: new Date("2026-09-30T23:59:59.999Z") };

/** A range ending on September's last local day is September's full bill — not October's, the month its end instant falls in. */
export async function assertARangeEndingOnAMonthsLastDayIsThatMonth(): Promise<void> {
  const h = harness([hour("priced", "2026-09-30T10:00:00.000Z", 5)]);
  const { rates, verify } = await h.resolver.resolveRangeRatesForAssets(["priced"], SEP_END.start, SEP_END.end);
  assert(rates.get("priced") === SEP_RATE, `expected September's ${SEP_RATE}, got ${String(rates.get("priced"))}`);
  assert(!verify, "an official version needs no badge");
}

/** A two-month range blends each month's energy at that month's rate. */
export async function assertATwoMonthRangePricesEachMonthAtItsRate(): Promise<void> {
  const h = harness([
    hour("priced", "2026-09-20T10:00:00.000Z", 10),
    hour("priced", "2026-10-05T10:00:00.000Z", 30),
    hour("secondary", "2026-10-05T10:00:00.000Z", 1),
  ]);
  const start = new Date("2026-09-15T00:00:00.000Z");
  const end = new Date("2026-10-10T23:59:59.999Z");
  const { rates, verify } = await h.resolver.resolveRangeRatesForAssets(["priced", "plain", "secondary"], start, end);
  const expected = (10 * SEP_RATE + 30 * OCT_RATE) / 40;
  assert(Math.abs(rates.get("priced")! - expected) < 1e-12, `expected the blend ${expected}, got ${String(rates.get("priced"))}`);
  assert(rates.get("plain") === FLAT, `an unmapped asset is the flat parameter, got ${String(rates.get("plain"))}`);
  assert(h.flatPointAt.length === 1 && h.flatPointAt[0] === end, "the unmapped asset is read at the range's end, as before");
  assert(JSON.stringify(h.flatPointPairs) === JSON.stringify([[tariff("plain")]]), `only the unmapped asset is a point read: ${JSON.stringify(h.flatPointPairs)}`);
  assert(rates.get("secondary") === 5392.5 / 600 && verify, "a secondary month's energy raises verify");
  const months = h.billCalls.flatMap((c) => c.targets).filter((t) => t.mapping.id === "m-priced").map((t) => t.month);
  assert(JSON.stringify(months) === JSON.stringify(["2026-09", "2026-10"]), `one bill per covered month: ${JSON.stringify(months)}`);
}

/** Fail closed: a covered month with energy and no price leaves the asset absent, never the flat parameter. */
export async function assertAnUnpricedMonthWithEnergyFailsClosed(): Promise<void> {
  const start = new Date("2026-09-15T00:00:00.000Z");
  const end = new Date("2026-10-10T23:59:59.999Z");
  const both = harness([hour("half", "2026-09-20T10:00:00.000Z", 10), hour("half", "2026-10-05T10:00:00.000Z", 30)]);
  const failed = await both.resolver.resolveRangeRatesForAssets(["half"], start, end);
  assert(!failed.rates.has("half"), `September is unpriced: expected absent, got ${String(failed.rates.get("half"))}`);
  assert(both.flatPointPairs.length === 0, "the flat parameter is never asked for a mapped asset");

  const octOnly = harness([hour("half", "2026-10-05T10:00:00.000Z", 30)]);
  const priced = await octOnly.resolver.resolveRangeRatesForAssets(["half"], start, end);
  assert(priced.rates.get("half") === OCT_RATE, `no energy in the unpriced month costs nothing: got ${String(priced.rates.get("half"))}`);
}

/** The pure blend: a month the mapping does not cover is the flat row; no energy at all is the latest priced month. */
export function assertTheBlendUsesTheFlatRowOutsideMappedMonths(): void {
  const oct = monthWindow("2026-10", KOLKATA);
  const months = [{ fromMs: oct.start.getTime(), toMs: oct.end.getTime(), rate: 10, verify: false }];
  const flat = [{ fromMs: 0, toMs: null, value: FLAT, rank: ORGANIZATION_RANK }];
  const mixed = blendRangeRate([hour("a", "2026-09-20T10:00:00.000Z", 1), hour("a", "2026-10-05T10:00:00.000Z", 3)], months, flat);
  assert(mixed.rate === (1 * FLAT + 3 * 10) / 4, `expected the flat-and-mapped blend, got ${String(mixed.rate)}`);
  const none = blendRangeRate([hour("a", "2026-10-05T10:00:00.000Z", 0)], months, flat);
  assert(none.rate === 10, `no energy: the latest priced month stands in, got ${String(none.rate)}`);
}
