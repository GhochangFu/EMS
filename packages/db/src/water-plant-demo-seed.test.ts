import { describe, it } from "vitest";

import {
  assertDerivedRowsAreKindDerived,
  assertDerivedRowsAreScheduledAndMeasuredRowsAreNot,
  assertDerivedRowsCarryTheirFormula,
  assertDerivedRowsCarryUnitKl,
  assertDerivedRowsGetDialectV3AndMeasuredRowsNone,
  assertDerivedRowsRunEverySixtySecondsAndMeasuredRowsNever,
  assertEveryPositionalArrayHasTheSameLength,
  assertMeasuredRowsAreKindMeasured,
  assertMeasuredRowsCarryNoFormulaAndTheirTier,
  assertMeasuredRowsCarryUnitKlPerHour,
  assertTheParamsBindElevenPositions,
  assertTheUnnestColumnsFollowTheParamsOrder,
} from "./water-plant-demo-seed.spec";

describe("E4.3 U11 — the demo water plant's template point params", () => {
  it("gives every positional array one entry per template row", () => {
    assertEveryPositionalArrayHasTheSameLength();
  });

  it("binds eleven positions, $1 through $11", () => {
    assertTheParamsBindElevenPositions();
  });

  it("unnests the columns in the order the params build them", () => {
    assertTheUnnestColumnsFollowTheParamsOrder();
  });

  it("writes each measured flow row in KL/hr", () => {
    assertMeasuredRowsCarryUnitKlPerHour();
  });

  it("writes each measured flow row as kind measured", () => {
    assertMeasuredRowsAreKindMeasured();
  });

  it("writes each measured flow row with no formula and its tier", () => {
    assertMeasuredRowsCarryNoFormulaAndTheirTier();
  });

  it("writes each derived volume row in KL", () => {
    assertDerivedRowsCarryUnitKl();
  });

  it("writes each derived volume row as kind derived", () => {
    assertDerivedRowsAreKindDerived();
  });

  it("writes each derived volume row with its own formula and no tier", () => {
    assertDerivedRowsCarryTheirFormula();
  });

  it("gives a derived row the v3 dialect, and a measured row none", () => {
    assertDerivedRowsGetDialectV3AndMeasuredRowsNone();
  });

  it("schedules a derived row, and not a measured row", () => {
    assertDerivedRowsAreScheduledAndMeasuredRowsAreNot();
  });

  it("runs a derived row every 60 s, and a measured row never", () => {
    assertDerivedRowsRunEverySixtySecondsAndMeasuredRowsNever();
  });
});
