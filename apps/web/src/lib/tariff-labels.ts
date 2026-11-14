import type { TariffLineDto } from "@bms/shared/contracts";

/**
 * `F4.365` (ADR 0134) — the words the tariff screens put beside a line, and the
 * month arithmetic their month inputs need. Every date the tariff API takes or
 * returns is the first day of a month, `YYYY-MM-01` (plan D8); an
 * `<input type="month">` holds `YYYY-MM`.
 */

type FixedBasis = TariffLineDto["fixedBasis"];
type EnergyUnit = TariffLineDto["energyUnit"];

const BASIS_LABELS: Record<FixedBasis, string> = {
  per_kw_month: "per kW per month",
  per_kva_month: "per kVA per month",
  per_hp_month: "per HP per month",
  per_connection_month: "per connection per month",
  per_connection_bimonth: "per connection per two months",
  none: "no fixed charge",
};

export const FIXED_BASES = Object.keys(BASIS_LABELS) as FixedBasis[];

/** The fixed/demand charge's basis, in words. */
export function fixedBasisLabel(basis: FixedBasis): string {
  return BASIS_LABELS[basis];
}

/** `kwh` → "kWh", `kvah` → "kVAh". */
export function energyUnitLabel(unit: EnergyUnit): string {
  return unit === "kwh" ? "kWh" : "kVAh";
}

/** `kw` → "kW", `kva` → "kVA", `hp` → "HP". */
export function loadUnitLabel(unit: "kw" | "kva" | "hp"): string {
  return unit === "kw" ? "kW" : unit === "kva" ? "kVA" : "HP";
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** `2026-04-01` → "Apr 2026". Read as UTC: the date names a month, not an instant. */
export function monthLabel(monthStart: string): string {
  return MONTH_LABEL.format(new Date(`${monthStart.slice(0, 7)}-01T00:00:00Z`));
}

/** `2026-04-01` → `2026-04`, the value an `<input type="month">` holds. */
export function toMonthInput(monthStart: string | null): string {
  return monthStart === null ? "" : monthStart.slice(0, 7);
}

/** `2026-04` → `2026-04-01`; an empty input is `null`. */
export function fromMonthInput(month: string): string | null {
  return month === "" ? null : `${month}-01`;
}

/** `now`'s calendar year and month (1–12) in `zone`, or in the browser's zone when none is given. */
function yearMonthOf(now: Date, zone: string | undefined): { year: number; month: number } {
  if (zone === undefined) return { year: now.getFullYear(), month: now.getMonth() + 1 };
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const part = (type: "year" | "month") => Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month") };
}

/**
 * The first day of the month after `now`'s, as `YYYY-MM-01` — in `zone` (a location's, where the
 * bill counts its months), else in the browser's zone.
 */
export function nextMonthStart(now: Date = new Date(), zone?: string): string {
  const { year, month } = yearMonthOf(now, zone);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return `${next.year}-${String(next.month).padStart(2, "0")}-01`;
}

/** `now`'s month as `YYYY-MM` — in `zone` when given, else in the browser's zone. */
export function currentMonthInput(now: Date = new Date(), zone?: string): string {
  const { year, month } = yearMonthOf(now, zone);
  return `${year}-${String(month).padStart(2, "0")}`;
}
