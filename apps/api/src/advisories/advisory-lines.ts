import {
  ADVISORY_DEFAULT_PF_THRESHOLD,
  ADVISORY_PROJECTION_DAYS,
  ADVISORY_TARGET_PF,
  ADVISORY_WINDOW_DAYS,
  type AdvisoryAmount,
} from "@bms/shared";

import { ORGANIZATION_RANK, type ParameterSeriesRow } from "../calc/calc-parameter-series";
import { BASELINE_ONLY_SENTENCE, MIXED_SENTENCE } from "../ml/ml-findings.anomaly-facts";
import { ADVISORY_PARAMETER_KEYS, type AdvisoryAnomalyContext, type AdvisoryTariff } from "./advisory-engine.types";

/**
 * `E1.6a` / ADR 0137 (plan §4.4, R-f, R-j, R-k) — every sentence an advisory
 * carries, built on the server. Pure: no database and no clock. A value is
 * already rounded by the engine; this file only formats it.
 *
 * Money reads `₹ 12,340` for `INR` (Indian grouping) and `USD 12,340`
 * otherwise (US grouping); quantities on the same card use the same grouping.
 * In the fixed sentences the word "₹" becomes the currency code when it is
 * not `INR`. No sentence holds a percentage or the word "saving": that word
 * lives only in `ADVISORY_DISCLAIMER`.
 */

const INR = "INR";
const DAYS = ADVISORY_WINDOW_DAYS;

const localeOf = (currency: string): string => (currency === INR ? "en-IN" : "en-US");

/** A whole number with the currency's grouping. */
export function formatQuantity(value: number, currency: string): string {
  return Math.round(value).toLocaleString(localeOf(currency), { maximumFractionDigits: 0 });
}

/** The money word of the fixed sentences: `₹` for INR, else the code. */
export function currencyWord(currency: string): string {
  return currency === INR ? "₹" : currency;
}

/** `₹ 12,340` for INR, `USD 12,340` otherwise (plan R-k). */
export function formatMoney(value: number, currency: string): string {
  return `${currencyWord(currency)} ${formatQuantity(value, currency)}`;
}

/** A power factor with 2 decimals: `0.87`, `0.90`. */
export function formatPf(value: number): string {
  return value.toFixed(2);
}

/**
 * A `tariff_pf_band` threshold as set: 2 to 3 decimals (`0.90`, `0.932`). The
 * headline asks for more places when 3 would still print it equal to the PF.
 */
function formatThreshold(value: number, places = 3): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: places, useGrouping: false });
}

/** A number with at most `places` decimals and no grouping. */
function formatPlain(value: number, places: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: places, useGrouping: false });
}

/** A number with at most 2 decimals and the currency's grouping. */
function formatGrouped(value: number, currency: string): string {
  return value.toLocaleString(localeOf(currency), { maximumFractionDigits: 2 });
}

/** The scope a series row's rank names: −1 tariff, 0 asset, 1…999,999 location, 1,000,000 organization. */
export function scopeWord(rank: number): "tariff" | "asset" | "location" | "organization" {
  if (rank < 0) return "tariff";
  if (rank === 0) return "asset";
  if (rank < ORGANIZATION_RANK) return "location";
  return "organization";
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** A local day label `YYYY-MM-DD` as `10 Nov 2026`. */
export function formatDayLabel(day: string): string {
  return dayFormat.format(new Date(`${day}T00:00:00Z`));
}

/** The local date of `ms` in `zone`, as `1 Apr 2026`. */
export function formatDateInZone(ms: number, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short", year: "numeric" }).format(
    ms,
  );
}

/** `(about <x> in 30 days if the last 7 days repeat)`. */
function thirty(text: string): string {
  return `(about ${text} in ${ADVISORY_PROJECTION_DAYS} days if the last ${DAYS} days repeat)`;
}

const TARGET = formatPf(ADVISORY_TARGET_PF);

// --- low_power_factor ------------------------------------------------------

/** `Power factor averaged <pf> over the last 7 days, below <threshold>.` */
export function pfHeadline(pf: number, threshold: number): string {
  const shown = formatPf(pf);
  let below = formatThreshold(threshold);
  for (let places = 4; below === shown && places <= 12; places += 1) below = formatThreshold(threshold, places);
  return `Power factor averaged ${shown} over the last ${DAYS} days, below ${below}.`;
}

/** `About <n> kVAh could be avoided at a power factor of <target> [30].` */
export function pfAvoidableLine(kvah: AdvisoryAmount, currency: string): string {
  const projected = `${formatQuantity(kvah.projected, currency)} kVAh`;
  return `About ${formatQuantity(kvah.window, currency)} kVAh could be avoided at a power factor of ${TARGET} ${thirty(projected)}.`;
}

/** `About <money> in 7 days [30].` */
export function moneyLine(money: AdvisoryAmount, currency: string): string {
  return `About ${formatMoney(money.window, currency)} in ${DAYS} days ${thirty(formatMoney(money.projected, currency))}.`;
}

/** Why a power-factor advisory shows no money (plan §4.2 step 5, R-j). */
export type PfNoMoneyReason = "kwh_tariff" | "no_tariff" | "no_rate";

/** The line in place of the money line of a power-factor advisory. */
export function pfNoMoneyLine(reason: PfNoMoneyReason, currency: string): string {
  const word = currencyWord(currency);
  switch (reason) {
    case "kwh_tariff":
      return `Your tariff bills kWh; a PF penalty is not modelled, so no ${word} is shown.`;
    case "no_tariff":
      return `No kVAh-billed tariff is set for this meter's site, so no ${word} is shown.`;
    case "no_rate":
      return `No rate is available for this meter, so no ${word} is shown.`;
  }
}

/** `About <n> kVAr of correction would bring it to <target>.` */
export function kvarLine(kvar: number, currency: string): string {
  return `About ${formatQuantity(kvar, currency)} kVAr of correction would bring it to ${TARGET}.`;
}

// --- excess_consumption ------------------------------------------------------

/** Where the excess baseline came from: the asset's own parameter, or its own history. */
export type BaselineSource = "parameter" | "history";

/** `Used <n> kWh in the last 7 days, <ratio> times your baseline of <n> kWh.` / `… its usual <n> kWh.` */
export function excessHeadline(
  kwh: number,
  ratio: number,
  baselineKwh: number,
  source: BaselineSource,
  currency: string,
): string {
  const base = `${formatQuantity(baselineKwh, currency)} kWh`;
  const tail = source === "parameter" ? `your baseline of ${base}` : `its usual ${base}`;
  return `Used ${formatQuantity(kwh, currency)} kWh in the last ${DAYS} days, ${formatPlain(ratio, 2)} times ${tail}.`;
}

/** `About <n> kWh above the baseline [30].` */
export function excessKwhLine(kwh: AdvisoryAmount, currency: string): string {
  const projected = `${formatQuantity(kwh.projected, currency)} kWh`;
  return `About ${formatQuantity(kwh.window, currency)} kWh above the baseline ${thirty(projected)}.`;
}

/** `No rate is set for this meter, so no ₹ is shown.` */
export function excessNoRateLine(currency: string): string {
  return `No rate is set for this meter, so no ${currencyWord(currency)} is shown.`;
}

/** `About <n> kg CO₂ in 7 days [30].` */
export function co2Line(co2Kg: AdvisoryAmount, currency: string): string {
  const projected = `${formatQuantity(co2Kg.projected, currency)} kg CO₂`;
  return `About ${formatQuantity(co2Kg.window, currency)} kg CO₂ in ${DAYS} days ${thirty(projected)}.`;
}

// --- context (plan R-d) ------------------------------------------------------

/**
 * The anomaly context of an excess advisory: the count line, then the
 * weak-signal sentence. `BASELINE_ONLY_SENTENCE` only when every mark is the
 * Baseline method's alone; otherwise `MIXED_SENTENCE`. No unusual hour → none.
 */
export function contextLines(context: AdvisoryAnomalyContext): string[] {
  if (context.unusualHours <= 0) return [];
  const hours = context.unusualHours === 1 ? "1 unusual hour" : `${context.unusualHours} unusual hours`;
  const count = `${hours} in this window on the Anomalies page (advisory); ${context.bothHours} marked by both methods.`;
  const baselineOnly = context.bothHours === 0 && context.baselineOnlyHours === context.unusualHours;
  return [count, baselineOnly ? BASELINE_ONLY_SENTENCE : MIXED_SENTENCE];
}

// --- assumptions ---------------------------------------------------------------

/** `Window: <d1> to <d7> (7 complete days), <zone>.` */
export function windowAssumption(days: readonly string[], timeZone: string): string {
  const first = formatDayLabel(days[0] ?? "");
  const last = formatDayLabel(days[days.length - 1] ?? "");
  return `Window: ${first} to ${last} (${DAYS} complete days), ${timeZone}.`;
}

const unitWord = (unit: AdvisoryTariff["energyUnit"]): string => (unit === "kvah" ? "kVAh" : "kWh");

/**
 * The rate in force at the window's end: the site's tariff when the row is a
 * mapped month, else the flat parameter's scope and date, else `No rate set.`
 */
export function rateAssumption(
  row: ParameterSeriesRow | undefined,
  tariff: AdvisoryTariff | null,
  zone: string,
): string {
  // Finiteness first: a mapped month whose bill fails is a NaN row at rank −1, and it has no rate.
  if (row === undefined || !Number.isFinite(row.value)) return "No rate set.";
  if (row.rank < 0 && tariff !== null) {
    const from = formatDayLabel(tariff.effectiveFrom);
    return `Rate: tariff "${tariff.name}", version from ${from}, billed in ${unitWord(tariff.energyUnit)}; the month's bill ÷ kWh.`;
  }
  return `Rate: ${ADVISORY_PARAMETER_KEYS.rate} at ${scopeWord(row.rank)} scope, from ${formatDateInZone(row.fromMs, zone)}.`;
}

/** The grid emission factor in force at the window's end, or that none is set. */
export function emissionAssumption(row: ParameterSeriesRow | undefined, zone: string): string {
  if (row === undefined || !Number.isFinite(row.value)) return "No grid emission factor set.";
  const date = formatDateInZone(row.fromMs, zone);
  return `Emission factor: ${formatPlain(row.value, 4)} kg CO₂/kWh at ${scopeWord(row.rank)} scope, from ${date}.`;
}

/**
 * The power-factor threshold: `tariff_pf_band` at its scope (`row`, the band in
 * use), or the default — because none is set, or because `ignored` is a band
 * set outside (0, 1].
 */
export function thresholdAssumption(row: ParameterSeriesRow | undefined, ignored?: ParameterSeriesRow): string {
  const key = ADVISORY_PARAMETER_KEYS.pfBand;
  const fallback = formatPf(ADVISORY_DEFAULT_PF_THRESHOLD);
  if (row !== undefined) return `Threshold: ${formatThreshold(row.value)} (${key}, ${scopeWord(row.rank)} scope).`;
  if (ignored !== undefined) {
    return `Threshold: ${fallback} (default; ${key} at ${scopeWord(ignored.rank)} scope is outside 0–1).`;
  }
  return `Threshold: ${fallback} (default; ${key} is not set).`;
}

/** The fixed target. */
export const TARGET_PF_ASSUMPTION = `Target power factor: ${TARGET} (fixed).`;

/** Which path gave the power factor (plan §4.2 step 1). */
export type PfPath = "registers" | "kva" | "pf";

/** The power factor's source. */
export function pfSourceAssumption(path: PfPath): string {
  switch (path) {
    case "registers":
      return "Power factor from the kWh and kVAh registers.";
    case "kva":
      return "Power factor estimated from hourly kW and kVA.";
    case "pf":
      return "Power factor estimated from hourly kW and PF.";
  }
}

/** The excess baseline's source. */
export function baselineAssumption(
  baseline: { readonly source: "parameter"; readonly perDay: number } | { readonly source: "history"; readonly windows: number },
  currency: string,
): string {
  if (baseline.source === "parameter") {
    return `Baseline: your ${ADVISORY_PARAMETER_KEYS.baseline} of ${formatGrouped(baseline.perDay, currency)} kWh/day × ${DAYS}.`;
  }
  return `Baseline: the median of ${baseline.windows} earlier ${DAYS}-day windows (own history).`;
}

/** Plan R-i: money on a meter that is not its site's billing meter. */
export const NOT_BILLING_METER_ASSUMPTION = "Priced at the site's tariff rate; this meter is not the billing meter.";

/** How the 30-day figure is made. */
export const PROJECTION_ASSUMPTION = `${ADVISORY_PROJECTION_DAYS}-day figure: the ${DAYS}-day figure × ${ADVISORY_PROJECTION_DAYS} ÷ ${DAYS}, if the last ${DAYS} days repeat.`;
