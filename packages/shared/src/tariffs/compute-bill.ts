/**
 * `F4.365` (ADR 0134 decisions 5–7, Amendment 1) — the pure monthly bill.
 *
 * Zod-free and side-effect-free so the API, the web preview and the tests all
 * price a month the same way. Semantics follow the owner's workbook
 * (`India_Electricity_Tariff_Calculator.xlsx`, "Bill Calculator" sheet) with
 * three owner rulings layered on top:
 *
 * - telescopic slabs: units in slab i = min(U, to_i) − to_{i−1}, never below 0;
 *   `fromUnits` is display only;
 * - units above a CLOSED last slab are billed at the last slab's rate and
 *   reported as `overflowUnits` (Amendment 1 — the workbook leaves them unbilled);
 * - wheeling is per slab: Σ units_i × wheeling_i;
 * - fixed rate = the rate of the highest slab reached, max(1, …), so at 0 units
 *   slab 1's fixed rate still applies;
 * - fixed multiplier: sanctioned load for the per-load bases, 1 per connection,
 *   0.5 for a bi-monthly connection charge (decision 6), 0 for `none`;
 * - `fixedFraction` scales the fixed charge only — 1 for the monthly bill,
 *   elapsed share of the month for the live rate (Amendment 1);
 * - each money line rounds to 2 decimals once; `total` is their sum.
 */

export type TariffEnergyUnit = "kwh" | "kvah";
export type TariffFixedBasis =
  | "per_kw_month"
  | "per_kva_month"
  | "per_hp_month"
  | "per_connection_month"
  | "per_connection_bimonth"
  | "none";
export type SanctionedLoadUnit = "kw" | "kva" | "hp";

export interface BillSlab {
  slabNo: number;
  fromUnits: number;
  toUnits: number | null;
  energyRate: number;
  fixedRate: number;
  wheelingRate: number;
}

export interface BillSlabLine {
  slabNo: number;
  fromUnits: number;
  toUnits: number | null;
  units: number;
  energyRate: number;
  energyCharge: number;
  wheelingRate: number;
  wheelingCharge: number;
}

export interface ComputeBillInput {
  slabs: readonly BillSlab[];
  fixedBasis: TariffFixedBasis;
  units: number;
  sanctionedLoad: number;
  /** Share of the monthly fixed charge to include, 0..1. Default 1. */
  fixedFraction?: number;
}

export interface ComputedBill {
  slabLines: BillSlabLine[];
  billedUnits: number;
  overflowUnits: number;
  energyCharge: number;
  highestSlabNo: number;
  fixedRate: number;
  fixedCharge: number;
  wheelingCharge: number;
  total: number;
}

export type RegisterDelta = { ok: true; value: number } | { ok: false; reason: "empty" | "decreasing" };

export type BilledUnitsResult =
  | { ok: true; units: number; estimated: boolean }
  | { ok: false; reason: "meter_no_reading" | "meter_decreasing" | "kvah_unavailable" };

/** Round half away from zero to 2 decimals, without binary drift on x.xx5. */
export function roundMoney(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-9)) / 100;
}

function finiteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0, got ${value}`);
  }
}

/** The fixed-charge multiplier a basis applies to the slab's fixed rate. */
export function fixedMultiplier(basis: TariffFixedBasis, sanctionedLoad: number): number {
  switch (basis) {
    case "per_kw_month":
    case "per_kva_month":
    case "per_hp_month":
      return sanctionedLoad;
    case "per_connection_month":
      return 1;
    case "per_connection_bimonth":
      return 0.5;
    case "none":
      return 0;
  }
}

/** The sanctioned-load unit a basis needs, or null when the load is not used. */
export function loadUnitForBasis(basis: TariffFixedBasis): SanctionedLoadUnit | null {
  switch (basis) {
    case "per_kw_month":
      return "kw";
    case "per_kva_month":
      return "kva";
    case "per_hp_month":
      return "hp";
    default:
      return null;
  }
}

export function computeBill(input: ComputeBillInput): ComputedBill {
  const { slabs, fixedBasis, units, sanctionedLoad } = input;
  const fixedFraction = input.fixedFraction ?? 1;
  finiteNonNegative(units, "units");
  finiteNonNegative(sanctionedLoad, "sanctionedLoad");
  if (!Number.isFinite(fixedFraction) || fixedFraction < 0 || fixedFraction > 1) {
    throw new RangeError(`fixedFraction must be within 0..1, got ${fixedFraction}`);
  }
  if (slabs.length === 0) {
    throw new RangeError("a tariff needs at least one slab");
  }

  const slabLines: BillSlabLine[] = [];
  let previousTo = 0;
  let billed = 0;
  let reached = 0;
  slabs.forEach((slab, index) => {
    const isLast = index === slabs.length - 1;
    const cap = slab.toUnits === null ? units : Math.min(units, slab.toUnits);
    let inSlab = Math.max(0, cap - previousTo);
    if (isLast && slab.toUnits !== null && units > slab.toUnits) {
      inSlab += units - slab.toUnits;
    }
    if (inSlab > 0) {
      reached += 1;
    }
    billed += inSlab;
    slabLines.push({
      slabNo: slab.slabNo,
      fromUnits: slab.fromUnits,
      toUnits: slab.toUnits,
      units: inSlab,
      energyRate: slab.energyRate,
      energyCharge: roundMoney(inSlab * slab.energyRate),
      wheelingRate: slab.wheelingRate,
      wheelingCharge: roundMoney(inSlab * slab.wheelingRate),
    });
    if (slab.toUnits !== null) {
      previousTo = slab.toUnits;
    }
  });

  const last = slabs[slabs.length - 1];
  const overflowUnits = last.toUnits !== null && units > last.toUnits ? units - last.toUnits : 0;
  const highestSlabNo = Math.max(1, reached);
  const fixedRate = slabs[highestSlabNo - 1].fixedRate;
  // The charges are the sums of the ROUNDED slab lines, so the rows a bill shows always add up
  // to its energy and wheeling charges (rounding the raw sums could differ by 0.01).
  const energyCharge = roundMoney(slabLines.reduce((sum, line) => sum + line.energyCharge, 0));
  const wheelingCharge = roundMoney(slabLines.reduce((sum, line) => sum + line.wheelingCharge, 0));
  const fixedCharge = roundMoney(fixedRate * fixedMultiplier(fixedBasis, sanctionedLoad) * fixedFraction);
  return {
    slabLines,
    billedUnits: billed,
    overflowUnits,
    energyCharge,
    highestSlabNo,
    fixedRate,
    fixedCharge,
    wheelingCharge,
    total: roundMoney(energyCharge + fixedCharge + wheelingCharge),
  };
}

/**
 * The billed quantity (decisions 4–5). A kWh category uses the kWh register
 * delta; a kVAh category uses the kVAh delta, else kWh ÷ average pf, marked
 * estimated, when 0 < pf ≤ 1.
 */
export function billedUnits(input: {
  energyUnit: TariffEnergyUnit;
  kwh: RegisterDelta;
  kvah: RegisterDelta;
  averagePf: number | null;
}): BilledUnitsResult {
  const fromDelta = (delta: RegisterDelta): BilledUnitsResult =>
    delta.ok
      ? { ok: true, units: delta.value, estimated: false }
      : { ok: false, reason: delta.reason === "empty" ? "meter_no_reading" : "meter_decreasing" };

  if (input.energyUnit === "kwh") {
    return fromDelta(input.kwh);
  }
  if (input.kvah.ok) {
    return fromDelta(input.kvah);
  }
  if (input.kvah.reason === "decreasing") {
    return { ok: false, reason: "meter_decreasing" };
  }
  const pf = input.averagePf;
  if (pf === null || !Number.isFinite(pf) || pf <= 0 || pf > 1) {
    return { ok: false, reason: "kvah_unavailable" };
  }
  if (!input.kwh.ok) {
    return input.kwh.reason === "decreasing"
      ? { ok: false, reason: "meter_decreasing" }
      : { ok: false, reason: "kvah_unavailable" };
  }
  return { ok: true, units: input.kwh.value / pf, estimated: true };
}
