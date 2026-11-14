import { expect } from "vitest";

import {
  currentMonthInput,
  energyUnitLabel,
  fixedBasisLabel,
  fromMonthInput,
  loadUnitLabel,
  monthLabel,
  nextMonthStart,
  toMonthInput,
} from "./tariff-labels";

/** `F4.365` (ADR 0134, plan D8) — the tariff screens' labels and month arithmetic. */

export function aMonthStartReadsAsItsMonthInEveryZone(): void {
  expect(monthLabel("2026-04-01")).toBe("Apr 2026");
  expect(monthLabel("2026-01-01")).toBe("Jan 2026");
}

export function monthInputsRoundTripToTheFirstDay(): void {
  expect(toMonthInput("2026-04-01")).toBe("2026-04");
  expect(toMonthInput(null)).toBe("");
  expect(fromMonthInput("2026-04")).toBe("2026-04-01");
  expect(fromMonthInput("")).toBeNull();
}

export function nextMonthStartCrossesTheYear(): void {
  expect(nextMonthStart(new Date(2026, 11, 31, 23, 0))).toBe("2027-01-01");
  expect(nextMonthStart(new Date(2026, 3, 1, 0, 0))).toBe("2026-05-01");
  expect(currentMonthInput(new Date(2026, 3, 30))).toBe("2026-04");
}

/** In a location's zone: 2026-10-31T20:00Z is already November in Kolkata, still October in New York. */
export function theMonthIsCountedInTheGivenZone(): void {
  const at = new Date("2026-10-31T20:00:00.000Z");
  expect(currentMonthInput(at, "Asia/Kolkata")).toBe("2026-11");
  expect(nextMonthStart(at, "Asia/Kolkata")).toBe("2026-12-01");
  expect(currentMonthInput(at, "America/New_York")).toBe("2026-10");
  expect(nextMonthStart(at, "America/New_York")).toBe("2026-11-01");
  expect(nextMonthStart(new Date("2026-12-31T19:00:00.000Z"), "Asia/Kolkata")).toBe("2027-02-01");
}

export function unitsAndBasesHaveWords(): void {
  expect(energyUnitLabel("kvah")).toBe("kVAh");
  expect(energyUnitLabel("kwh")).toBe("kWh");
  expect(loadUnitLabel("kva")).toBe("kVA");
  expect(loadUnitLabel("hp")).toBe("HP");
  expect(loadUnitLabel("kw")).toBe("kW");
  expect(fixedBasisLabel("per_kva_month")).toBe("per kVA per month");
  expect(fixedBasisLabel("none")).toBe("no fixed charge");
}
