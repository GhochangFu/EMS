import { ADVISORY_DEFAULT_PF_THRESHOLD, ADVISORY_MIN_COVERAGE, ADVISORY_TARGET_PF, type Advisory } from "@bms/shared";

import type { AdvisoryAssetInput, AdvisoryRegisters, AdvisoryWindows } from "./advisory-engine.types";
import {
  kvarLine,
  moneyLine,
  NOT_BILLING_METER_ASSUMPTION,
  pfAvoidableLine,
  pfHeadline,
  pfNoMoneyLine,
  pfSourceAssumption,
  PROJECTION_ASSUMPTION,
  rateAssumption,
  TARGET_PF_ASSUMPTION,
  thresholdAssumption,
  windowAssumption,
  type PfNoMoneyReason,
  type PfPath,
} from "./advisory-lines";
import { advisoryIdentity, amountOf, hasCoverage, rowAtWindowEnd, windowFacts } from "./advisory-window";

/**
 * `E1.6a` / ADR 0137 decision 2 (plan §4.2, Q1, Q5, R-g, R-h, R-i, R-j) — the
 * low power factor advisory of one electrical meter. Pure: no database, no
 * clock.
 *
 * PF comes from the first path that gives a value in (0, 1] over at least
 * `ADVISORY_MIN_COVERAGE` of the window (probe span, or hours with both values):
 * the kWh and kVAh register deltas; else Σ hourly mean kW ÷ Σ hourly mean kVA; else
 * Σ kW ÷ Σ (kW ÷ pf). The advisory fires when the PF rounded to 2 decimals is
 * below the threshold and the PF is below the target. Money (Q1) only on a
 * kVAh-billed tariff with every day of the window priced:
 * `C × (1 − PF ÷ target)`, which is avoidable kVAh × PF × the average rate per
 * kWh, the unit the system's rate is in.
 */

const round2 = (value: number): number => Math.round(value * 100) / 100;
const isPowerFactor = (value: number): boolean => Number.isFinite(value) && value > 0 && value <= 1;

/**
 * A register pair whose ratio is a power factor in (0, 1] and whose probes span
 * at least `ADVISORY_MIN_COVERAGE` of the window: path (i) answers and the hourly
 * pair read is not needed. The one register test, shared with
 * `advisories.service.ts` so its pre-filter and the engine agree.
 */
export function hasUsableRegisters(registers: AdvisoryRegisters, windows: AdvisoryWindows): boolean {
  const { kwh, kvah, spanMs } = registers;
  // Coverage of the window (owner ruling 2026-11-17, E1.6a code review).
  const spansWindow = spanMs >= ADVISORY_MIN_COVERAGE * (windows.toMs - windows.fromMs);
  return kwh !== null && kvah !== null && kvah > 0 && isPowerFactor(kwh / kvah) && spansWindow;
}

/** The window's PF, the path that gave it, and the kWh the avoidable kVAh is computed on. */
export function powerFactorOf(
  input: AdvisoryAssetInput,
  windows: AdvisoryWindows,
  windowKwh: number,
): { pf: number; path: PfPath; kwh: number } | null {
  const { kwh, kvah } = input.registers;
  if (kwh !== null && kvah !== null && hasUsableRegisters(input.registers, windows)) {
    return { pf: kwh / kvah, path: "registers", kwh };
  }
  const inWindow = input.pairHours.filter((hour) => hour.bucketMs >= windows.fromMs && hour.bucketMs < windows.toMs);

  // Each path needs the kW coverage rule's hours (owner ruling 2026-11-17, E1.6a code review).
  let kwSum = 0;
  let kvaSum = 0;
  let hours = 0;
  for (const hour of inWindow) {
    if (hour.kw === null || hour.kva === null || !Number.isFinite(hour.kw) || !Number.isFinite(hour.kva)) continue;
    kwSum += hour.kw;
    kvaSum += hour.kva;
    hours += 1;
  }
  if (hasCoverage(hours) && kvaSum > 0 && isPowerFactor(kwSum / kvaSum)) {
    return { pf: kwSum / kvaSum, path: "kva", kwh: windowKwh };
  }

  kwSum = 0;
  let apparentSum = 0;
  hours = 0;
  for (const hour of inWindow) {
    if (hour.kw === null || hour.pf === null || !Number.isFinite(hour.kw) || !isPowerFactor(hour.pf)) continue;
    kwSum += hour.kw;
    apparentSum += hour.kw / hour.pf;
    hours += 1;
  }
  if (hasCoverage(hours) && apparentSum > 0 && isPowerFactor(kwSum / apparentSum)) {
    return { pf: kwSum / apparentSum, path: "pf", kwh: windowKwh };
  }
  return null;
}

/** The `low_power_factor` advisory of one asset, or `null` when it does not fire. */
export function lowPowerFactorAdvisory(input: AdvisoryAssetInput, windows: AdvisoryWindows): Advisory | null {
  const { candidate, tariff, series } = input;
  if (candidate.domain !== "electrical") return null;
  const facts = windowFacts(input, windows);
  if (!hasCoverage(facts.bucketCount)) return null;
  const found = powerFactorOf(input, windows, facts.kwh);
  if (found === null) return null;

  const band = rowAtWindowEnd(series.pfBand, windows);
  const bandRow = band !== undefined && isPowerFactor(band.value) ? band : undefined;
  const threshold = bandRow?.value ?? ADVISORY_DEFAULT_PF_THRESHOLD;
  const shown = round2(found.pf);
  if (!(shown < threshold && found.pf < ADVISORY_TARGET_PF)) return null;

  const avoidable = found.kwh / found.pf - found.kwh / ADVISORY_TARGET_PF;
  const meanKw = facts.kwh / facts.bucketCount;
  const kvar = meanKw * (Math.tan(Math.acos(found.pf)) - Math.tan(Math.acos(ADVISORY_TARGET_PF)));
  const kvah = amountOf(avoidable);

  const kvahBilled = tariff !== null && tariff.energyUnit === "kvah";
  const money = kvahBilled && facts.cost !== null ? amountOf(facts.cost * (1 - found.pf / ADVISORY_TARGET_PF)) : null;
  const noMoney: PfNoMoneyReason = tariff === null ? "no_tariff" : kvahBilled ? "no_rate" : "kwh_tariff";
  const notBillingMeter = money !== null && tariff !== null && !tariff.billingMeter;
  const measured = found.path === "registers" && bandRow !== undefined && !notBillingMeter;

  const { currency } = candidate;
  return {
    ...advisoryIdentity(candidate, windows, "low_power_factor"),
    confidence: measured ? "measured" : "estimated",
    headline: pfHeadline(shown, threshold),
    lines: [
      pfAvoidableLine(kvah, currency),
      money !== null ? moneyLine(money, currency) : pfNoMoneyLine(noMoney, currency),
      kvarLine(kvar, currency),
    ],
    assumptions: [
      windowAssumption(windows.days, candidate.timeZone),
      rateAssumption(rowAtWindowEnd(series.rate, windows), tariff, candidate.zone),
      thresholdAssumption(bandRow, band),
      TARGET_PF_ASSUMPTION,
      pfSourceAssumption(found.path),
      ...(notBillingMeter ? [NOT_BILLING_METER_ASSUMPTION] : []),
      PROJECTION_ASSUMPTION,
    ],
    money,
    kwh: null,
    kvah,
    co2Kg: null,
    kvar: Math.round(kvar),
    powerFactor: shown,
  };
}
