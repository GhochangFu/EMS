import { toKpiTileProps } from "./widget-value";

/**
 * `F4.332` — the tile notes: an `energy.cost.total` tile counts days and says why it is null, and
 * a tile showing a stored `energy_cost_*` point says "at the rate effective now" (ADR 0070
 * Amendment 7 decision 8).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const base = { title: "Cost this month", status: "ready" as const, config: {} };

export function aCostTotalTileCountsDays(): void {
  const props = toKpiTileProps({ ...base, primary: 1200, currency: "INR", coverage: { fresh: 5, carrying: 7 }, catalogKey: "energy.cost.total" });
  assert(props.note === "5 of 7 days priced", `the note must count days, got ${props.note}`);
}

export function aNullCostTotalTileSaysWhy(): void {
  const props = toKpiTileProps({ ...base, primary: null, currency: "INR", reason: "rate_missing", catalogKey: "energy.cost.total" });
  assert(props.note === "No energy rate for this period", `the note must say why, got ${props.note}`);
}

export function aStoredCostTileSaysTheRateIsToday(): void {
  const props = toKpiTileProps({ ...base, primary: 900, currency: "INR", catalogKey: "sustainability.total", storedCost: true });
  assert(props.note === "at the rate effective now", `a stored cost tile must carry the note, got ${props.note}`);
  const partial = toKpiTileProps({ ...base, primary: 900, coverage: { fresh: 4, carrying: 6 }, catalogKey: "sustainability.total", storedCost: true });
  assert(partial.note === "4 of 6 assets · at the rate effective now", `the note joins the coverage, got ${partial.note}`);
}

export function anotherTileHasNoCostNote(): void {
  const props = toKpiTileProps({ ...base, primary: 12, catalogKey: "sustainability.total" });
  assert(props.note === undefined, `a plain tile must have no note, got ${props.note}`);
}
