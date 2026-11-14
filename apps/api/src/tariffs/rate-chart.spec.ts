import { RATE_CHART_HEADER, parseRateChart, serialiseSnapshot } from "./rate-chart";

/** `F4.365` U3 — the Rate Chart parser (ADR 0134 decision 2, plan D7). Vitest entry in the sibling `.test.ts`. */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const SOURCE = { workbook: "fixture.xlsx", sha256: "a".repeat(64) };
const URL = "https://example.org/order.pdf";

/** One Rate Chart row; `over` patches columns by header title. */
function row(key: string, slabNo: number, from: number, to: number | null, over: Partial<Record<(typeof RATE_CHART_HEADER)[number], unknown>> = {}): unknown[] {
  const base: Record<string, unknown> = {
    "Category Key": key,
    "Area ID": "MH",
    "State / UT": "Maharashtra",
    "Discom(s)": "MSEDCL",
    Ownership: "Government (State/UT)",
    "Category Code": "LT-I",
    Category: "Residential",
    Segment: "Domestic",
    Supply: "LT",
    "Slab No": slabNo,
    "Slab From (units)": from,
    "Slab To (units)": to,
    "Energy Charge (Rs/unit)": 4,
    "Energy Unit": "kWh",
    "Fixed/Demand Charge (Rs)": 130,
    "Fixed Charge Basis": "Rs/connection/month",
    "Wheeling / Reg. Surcharge (Rs/unit)": 1.6,
    Notes: null,
    "Data Status": "Official tariff schedule/order",
    "Tariff Order": "MERC order",
    "Effective From": "01-04-2026",
    Source: URL,
    ...over,
  };
  return RATE_CHART_HEADER.map((title) => base[title]);
}

const HEADER = [...RATE_CHART_HEADER];

export function assertTheHappyPathParses(): void {
  const r = parseRateChart([HEADER, row("A", 1, 0, 100), row("A", 2, 101, null), row("B", 1, 0, null, { "Energy Unit": "kVAh" })], SOURCE);
  assert(r.ok, `happy path: ${r.ok ? "" : r.problems.join("; ")}`);
  if (!r.ok) return;
  const [a, b] = r.snapshot.categories;
  assert(a.key === "A" && a.slabs.length === 2 && a.slabs[1].toUnits === null, "A's slabs");
  assert(a.effectiveFrom === "2026-04-01" && a.fixedBasis === "per_connection_month" && a.dataStatus === "official", "A's fields");
  assert(b.energyUnit === "kvah", "B's unit");
}

/** D7: Haryana DS-II — slabs 1–2 blank, 3–4 per kW — resolves to `per_kw_month`; blank charge is 0. */
export function assertAMixedBlankBasisResolves(): void {
  const blank = { "Fixed Charge Basis": null, "Fixed/Demand Charge (Rs)": 0 };
  const kw = { "Fixed Charge Basis": "Rs/kW/month", "Fixed/Demand Charge (Rs)": 50 };
  const r = parseRateChart([HEADER, row("H", 1, 0, 150, blank), row("H", 2, 151, 300, blank), row("H", 3, 301, 500, kw), row("H", 4, 501, null, kw)], SOURCE);
  assert(r.ok && r.snapshot.categories[0].fixedBasis === "per_kw_month", "mixed blank basis → per_kw_month");
  assert(r.ok && r.snapshot.categories[0].slabs.map((s) => s.fixedRate).join() === "0,0,50,50", "fixed rates");
}

export function assertTwoBasesAreRefused(): void {
  const r = parseRateChart([HEADER, row("X", 1, 0, 100), row("X", 2, 101, null, { "Fixed Charge Basis": "Rs/kW/month" })], SOURCE);
  assert(!r.ok && r.problems.some((p) => p.includes("mixes bases")), "two bases");
}

export function assertANonContiguousKeyIsRefused(): void {
  const r = parseRateChart([HEADER, row("A", 1, 0, null), row("B", 1, 0, null), row("A", 1, 0, null)], SOURCE);
  assert(!r.ok && r.problems.some((p) => p.includes("contiguous")), "non-contiguous");
}

export function assertAnUnknownStatusIsRefused(): void {
  const r = parseRateChart([HEADER, row("A", 1, 0, null, { "Data Status": "Guess" })], SOURCE);
  assert(!r.ok && r.problems.some((p) => p.includes("unknown status")), "unknown status");
}

export function assertAFromGapIsRefused(): void {
  const r = parseRateChart([HEADER, row("A", 1, 0, 100), row("A", 2, 150, null)], SOURCE);
  assert(!r.ok && r.problems.some((p) => p.includes("must start at 101")), `gap: ${r.ok ? "" : r.problems.join("; ")}`);
}

export function assertAMidMonthDateIsRefused(): void {
  const r = parseRateChart([HEADER, row("A", 1, 0, null, { "Effective From": "15-04-2026" })], SOURCE);
  assert(!r.ok && r.problems.some((p) => p.includes("day 01")), "mid-month");
}

export function assertAWrongHeaderIsRefused(): void {
  const r = parseRateChart([HEADER.slice(1), row("A", 1, 0, null)], SOURCE);
  assert(!r.ok && r.problems[0].startsWith("the header row"), "header");
}

export function assertSerialisationIsStable(): void {
  const one = parseRateChart([HEADER, row("B", 1, 0, null), row("A", 1, 0, null)], SOURCE);
  const two = parseRateChart([HEADER, row("A", 1, 0, null), row("B", 1, 0, null)], SOURCE);
  assert(one.ok && two.ok, "both parse");
  if (!one.ok || !two.ok) return;
  assert(serialiseSnapshot(one.snapshot) === serialiseSnapshot(two.snapshot), "order-independent");
  assert(serialiseSnapshot(one.snapshot).endsWith("}\n"), "trailing newline");
}
