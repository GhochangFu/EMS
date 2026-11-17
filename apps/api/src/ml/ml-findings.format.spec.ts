import { expect } from "vitest";

import { formatFindingTime, formatFindingValue, formatSignedChange, tempWords } from "./ml-findings.format";

/**
 * `E1.9a` / ADR 0135 Amendment 8 (plan §4.1, T1.2) — the words and formats of
 * the fact sentences. Assertions live here; `ml-findings.format.test.ts` is the
 * vitest entry point (ADR 0014).
 */
export function aValueHasAtMostTwoDecimalsNoGroupingAndItsUnit(): void {
  expect(formatFindingValue(-18.456, "°C")).toBe("-18.46 °C");
  expect(formatFindingValue(1234.5, null)).toBe("1234.5");
  expect(formatFindingValue(1234567.891, "kW")).toBe("1234567.89 kW");
  expect(formatFindingValue(2, "kW")).toBe("2 kW");
  expect(formatFindingValue(-0.001, null), "no negative zero").toBe("0");
  expect(formatFindingValue(-3.5, null)).not.toContain("−");
}

export function aSignedChangeCarriesItsSign(): void {
  expect(formatSignedChange(1.234, "°C")).toBe("+1.23 °C");
  expect(formatSignedChange(-2, "°C")).toBe("-2 °C");
  expect(formatSignedChange(-0.001, null)).toBe("+0");
}

export function aTimeIsDayMonthAndHourInTheSitesZone(): void {
  const ms = Date.parse("2026-11-17T08:35:00.000Z");
  expect(formatFindingTime(ms, "Asia/Kolkata")).toBe("17 Nov 14:05");
  expect(formatFindingTime(ms, "UTC")).toBe("17 Nov 08:35");
  expect(formatFindingTime(Date.parse("2026-11-17T23:05:00.000Z"), "Asia/Kolkata"), "the site's day").toBe("18 Nov 04:35");
}

export function anUnknownZoneFallsBackToUtc(): void {
  const ms = Date.parse("2026-11-17T08:35:00.000Z");
  expect(formatFindingTime(ms, "Not/AZone")).toBe("17 Nov 08:35");
  expect(formatFindingTime(ms, "")).toBe("17 Nov 08:35");
}

export function aCelsiusPointSaysColdestAndWarmest(): void {
  expect(tempWords("°C")).toEqual({ low: "coldest", high: "warmest" });
  expect(tempWords("kW")).toEqual({ low: "lowest", high: "highest" });
  expect(tempWords(null)).toEqual({ low: "lowest", high: "highest" });
}
