import { billedUnits, computeBill, roundMoney, type BillSlab, type TariffFixedBasis } from "./compute-bill";

/**
 * `F4.365` U1 — the golden bills of the step-3 plan §1, computed with the
 * owner's workbook formulas (ADR 0134 decision 6) and the Amendment 1 rulings.
 * Slab literals are copied from the Rate Chart sheet.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function slab(slabNo: number, fromUnits: number, toUnits: number | null, energyRate: number, fixedRate: number, wheelingRate = 0): BillSlab {
  return { slabNo, fromUnits, toUnits, energyRate, fixedRate, wheelingRate };
}

interface Golden {
  name: string;
  slabs: BillSlab[];
  basis: TariffFixedBasis;
  units: number;
  load: number;
  energy: number;
  fixed: number;
  wheeling: number;
  total: number;
  overflow?: number;
}

const MSEDCL_LT_IB = [
  slab(1, 0, 100, 3.96, 130, 1.6),
  slab(2, 101, 300, 10.8, 130, 1.6),
  slab(3, 301, 500, 15.03, 130, 1.6),
  slab(4, 501, null, 17.53, 130, 1.6),
];
const RAJASTHAN_DS = [
  slab(1, 0, 50, 4.75, 150, 0.7),
  slab(2, 51, 150, 6, 150, 0.7),
  slab(3, 151, 500, 7, 300, 1),
  slab(4, 501, null, 7.5, 800, 1),
];
const HARYANA_DS_II = [
  slab(1, 0, 150, 2.95, 0),
  slab(2, 151, 300, 5.25, 0),
  slab(3, 301, 500, 6.45, 50),
  slab(4, 501, null, 7.1, 50),
];
const TELANGANA_LT_IB_II = [
  slab(1, 0, 200, 5.1, 10),
  slab(2, 201, 300, 7.7, 10),
  slab(3, 301, 400, 9, 10),
  slab(4, 401, 800, 9.5, 10),
  slab(5, 801, null, 10, 50),
];
const ODISHA_1B = [slab(1, 0, 50, 2.9, 20), slab(2, 51, 200, 4.7, 20), slab(3, 201, 400, 5.7, 20), slab(4, 401, null, 6.1, 20)];
const TN_LT_IA_A = [slab(1, 0, 200, 0, 45), slab(2, 201, 400, 4.7, 45), slab(3, 401, 500, 6.3, 45)];
const ODISHA_KUTIR = [slab(1, 0, 30, 0, 70)];
const MSEDCL_HT_IA = [slab(1, 0, null, 8.44, 650, 0.81)];

export const GOLDEN: Golden[] = [
  { name: "MSEDCL LT-I(B) 250 u", slabs: MSEDCL_LT_IB, basis: "per_connection_month", units: 250, load: 3, energy: 2016, fixed: 130, wheeling: 400, total: 2546 },
  { name: "Rajasthan DS 600 u", slabs: RAJASTHAN_DS, basis: "per_connection_month", units: 600, load: 5, energy: 4037.5, fixed: 800, wheeling: 555, total: 5392.5 },
  { name: "Rajasthan DS 0 u", slabs: RAJASTHAN_DS, basis: "per_connection_month", units: 0, load: 5, energy: 0, fixed: 150, wheeling: 0, total: 150 },
  { name: "Haryana DS-II 250 u", slabs: HARYANA_DS_II, basis: "per_kw_month", units: 250, load: 5, energy: 967.5, fixed: 0, wheeling: 0, total: 967.5 },
  { name: "Haryana DS-II 400 u", slabs: HARYANA_DS_II, basis: "per_kw_month", units: 400, load: 5, energy: 1875, fixed: 250, wheeling: 0, total: 2125 },
  { name: "Telangana LT-I(B)(ii) 900 u", slabs: TELANGANA_LT_IB_II, basis: "per_kw_month", units: 900, load: 4, energy: 7490, fixed: 200, wheeling: 0, total: 7690 },
  { name: "Odisha 1b 50.5 u", slabs: ODISHA_1B, basis: "per_kw_month", units: 50.5, load: 2, energy: 147.35, fixed: 40, wheeling: 0, total: 187.35 },
  { name: "Tamil Nadu LT-IA-A 450 u (bi-monthly, half)", slabs: TN_LT_IA_A, basis: "per_connection_bimonth", units: 450, load: 2, energy: 1255, fixed: 22.5, wheeling: 0, total: 1277.5 },
  { name: "Odisha Kutir Jyoti 100 u (70 overflow at last slab rate)", slabs: ODISHA_KUTIR, basis: "per_connection_month", units: 100, load: 1, energy: 0, fixed: 70, wheeling: 0, total: 70, overflow: 70 },
  { name: "MSEDCL HT-I(A) 120000 kVAh", slabs: MSEDCL_HT_IA, basis: "per_kva_month", units: 120000, load: 500, energy: 1012800, fixed: 325000, wheeling: 97200, total: 1435000 },
];

export function assertGoldenBill(golden: Golden): void {
  const bill = computeBill({ slabs: golden.slabs, fixedBasis: golden.basis, units: golden.units, sanctionedLoad: golden.load });
  const expect = (label: string, got: number, want: number) =>
    assert(Math.abs(got - want) < 1e-9, `${golden.name}: ${label} ${got} !== ${want}`);
  expect("energyCharge", bill.energyCharge, golden.energy);
  expect("fixedCharge", bill.fixedCharge, golden.fixed);
  expect("wheelingCharge", bill.wheelingCharge, golden.wheeling);
  expect("total", bill.total, golden.total);
  expect("overflowUnits", bill.overflowUnits, golden.overflow ?? 0);
  expect("billedUnits", bill.billedUnits, golden.units);
  expect("slab units sum", bill.slabLines.reduce((s, l) => s + l.units, 0), golden.units);
  expect("energy = Σ rounded lines", bill.energyCharge, roundMoney(bill.slabLines.reduce((s, l) => s + l.energyCharge, 0)));
  expect("wheeling = Σ rounded lines", bill.wheelingCharge, roundMoney(bill.slabLines.reduce((s, l) => s + l.wheelingCharge, 0)));
}

/** Amendment 1: units above a closed last slab take the last slab's rate. */
export function assertOverflowTakesTheLastSlabRate(): void {
  const bill = computeBill({ slabs: TN_LT_IA_A, fixedBasis: "none", units: 600, sanctionedLoad: 0 });
  assert(bill.overflowUnits === 100, `overflow ${bill.overflowUnits}`);
  assert(bill.slabLines[2].units === 200, `last slab units ${bill.slabLines[2].units}`);
  assert(bill.energyCharge === 940 + 1260, `energy ${bill.energyCharge}`);
}

/** Amendment 1: the live rate scales only the fixed charge. */
export function assertFixedFractionScalesOnlyTheFixedCharge(): void {
  const full = computeBill({ slabs: MSEDCL_HT_IA, fixedBasis: "per_kva_month", units: 4000, sanctionedLoad: 500 });
  const tenth = computeBill({ slabs: MSEDCL_HT_IA, fixedBasis: "per_kva_month", units: 4000, sanctionedLoad: 500, fixedFraction: 0.1 });
  assert(full.fixedCharge === 325000 && tenth.fixedCharge === 32500, `fixed ${full.fixedCharge} / ${tenth.fixedCharge}`);
  assert(tenth.energyCharge === full.energyCharge && tenth.wheelingCharge === full.wheelingCharge, "energy/wheeling changed");
  let threw = false;
  try {
    computeBill({ slabs: MSEDCL_HT_IA, fixedBasis: "none", units: 1, sanctionedLoad: 0, fixedFraction: 1.5 });
  } catch (e) {
    threw = e instanceof RangeError;
  }
  assert(threw, "fixedFraction 1.5 must throw RangeError");
}

export function assertInvalidInputThrows(): void {
  for (const units of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    let threw = false;
    try {
      computeBill({ slabs: ODISHA_1B, fixedBasis: "none", units, sanctionedLoad: 0 });
    } catch (e) {
      threw = e instanceof RangeError;
    }
    assert(threw, `units ${units} must throw RangeError`);
  }
}

export function assertBilledUnitsRules(): void {
  const none = { ok: false as const, reason: "empty" as const };
  const measured = billedUnits({ energyUnit: "kvah", kwh: { ok: true, value: 96000 }, kvah: { ok: true, value: 110000 }, averagePf: 0.8 });
  assert(measured.ok && measured.units === 110000 && !measured.estimated, "measured kVAh");
  const estimated = billedUnits({ energyUnit: "kvah", kwh: { ok: true, value: 96000 }, kvah: none, averagePf: 0.8 });
  assert(estimated.ok && Math.abs(estimated.units - 120000) < 1e-6 && estimated.estimated, "estimated kVAh");
  for (const pf of [0, 1.2, null]) {
    const r = billedUnits({ energyUnit: "kvah", kwh: { ok: true, value: 96000 }, kvah: none, averagePf: pf });
    assert(!r.ok && r.reason === "kvah_unavailable", `pf ${pf}`);
  }
  const kwh = billedUnits({ energyUnit: "kwh", kwh: { ok: true, value: 250 }, kvah: none, averagePf: null });
  assert(kwh.ok && kwh.units === 250 && !kwh.estimated, "kwh");
  const empty = billedUnits({ energyUnit: "kwh", kwh: none, kvah: none, averagePf: null });
  assert(!empty.ok && empty.reason === "meter_no_reading", "empty kwh");
  const down = billedUnits({ energyUnit: "kwh", kwh: { ok: false, reason: "decreasing" }, kvah: none, averagePf: null });
  assert(!down.ok && down.reason === "meter_decreasing", "decreasing kwh");
}

/** The energy and wheeling charges are the sums of the rounded lines the bill shows, never 0.01 apart. */
export function assertChargesAreTheSumOfTheRoundedLines(): void {
  // Each line is 0.004 → 0.00; the raw sum 0.008 would round to 0.01.
  const slabs = [slab(1, 0, 1, 0.004, 0, 0.004), slab(2, 1, null, 0.004, 0, 0.004)];
  const bill = computeBill({ slabs, fixedBasis: "none", units: 2, sanctionedLoad: 0 });
  assert(bill.slabLines.every((l) => l.energyCharge === 0 && l.wheelingCharge === 0), JSON.stringify(bill.slabLines));
  assert(bill.energyCharge === 0 && bill.wheelingCharge === 0, `energy ${bill.energyCharge} wheeling ${bill.wheelingCharge}`);
  assert(bill.total === 0, `total ${bill.total}`);
}
