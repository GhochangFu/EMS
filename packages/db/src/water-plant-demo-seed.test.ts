import { describe, it } from "vitest";

import {
  assertDerivedRowsAreKindDerived,
  assertDerivedRowsAreScheduledAndMeasuredRowsAreNot,
  assertDerivedRowsCarryANonNullFormula,
  assertDerivedRowsCarryNoTier,
  assertDerivedRowsCarryTheirFormula,
  assertDerivedRowsCarryUnitKl,
  assertDerivedRowsRunEverySixtySecondsAndMeasuredRowsNever,
  assertEveryPositionalArrayHasTheSameLength,
  assertMeasuredRowsAreKindMeasured,
  assertMeasuredRowsCarryNoFormula,
  assertMeasuredRowsCarryTheirTier,
  assertMeasuredRowsCarryUnitKlPerHour,
  assertOnlyADerivedRowGetsTheDialect,
  assertTheDerivedRowsEqualTheVolumeRowsInEveryColumn,
  assertTheDialectParamIsV3,
  assertTheMeasuredRowsEqualTheFlowRowsInEveryColumn,
  assertTheParamsHaveElevenEntries,
  assertThePinnedCountMatchesTheAssetToItsOwnTemplate,
  assertThePinnedCountZipsTheTwoCodeLists,
  assertThePostConditionReadsNoLikePattern,
  assertTheSqlBindsNoPositionTwelve,
  assertTheSqlBindsPositionEleven,
  assertTheTemplatePointsCountReadsTheFiveCodes,
  assertTheUnnestArraysAreTypedInOrder,
  assertTheUnnestColumnListFollowsTheParamsOrder,
  assertTheVerifyParamsPairEachAssetWithItsOwnTemplate,
} from "./water-plant-demo-seed.spec";

describe("E4.3 U11 — the demo water plant's template point params", () => {
  it("gives every positional array one entry per template row", () => {
    assertEveryPositionalArrayHasTheSameLength();
  });

  it("writes the flow rows first, equal to flowRows in every column", () => {
    assertTheMeasuredRowsEqualTheFlowRowsInEveryColumn();
  });

  it("writes the volume rows after them, equal to derivedRows in every column", () => {
    assertTheDerivedRowsEqualTheVolumeRowsInEveryColumn();
  });

  it("carries eleven params", () => {
    assertTheParamsHaveElevenEntries();
  });

  it("binds $11 in the SQL", () => {
    assertTheSqlBindsPositionEleven();
  });

  it("binds no $12 in the SQL", () => {
    assertTheSqlBindsNoPositionTwelve();
  });

  it("unnests $4 through $11 with the params' types, in order", () => {
    assertTheUnnestArraysAreTypedInOrder();
  });

  it("names the unnest columns in the order the params build them", () => {
    assertTheUnnestColumnListFollowsTheParamsOrder();
  });

  it("writes each measured flow row in KL/hr", () => {
    assertMeasuredRowsCarryUnitKlPerHour();
  });

  it("writes each measured flow row as kind measured", () => {
    assertMeasuredRowsAreKindMeasured();
  });

  it("writes each measured flow row with no formula", () => {
    assertMeasuredRowsCarryNoFormula();
  });

  it("writes each measured flow row with its stock tier", () => {
    assertMeasuredRowsCarryTheirTier();
  });

  it("writes each derived volume row in KL", () => {
    assertDerivedRowsCarryUnitKl();
  });

  it("writes each derived volume row as kind derived", () => {
    assertDerivedRowsAreKindDerived();
  });

  it("writes each derived volume row with its own formula", () => {
    assertDerivedRowsCarryTheirFormula();
  });

  it("writes each derived volume row with a non-null formula", () => {
    assertDerivedRowsCarryANonNullFormula();
  });

  it("writes each derived volume row with no tier", () => {
    assertDerivedRowsCarryNoTier();
  });

  it("binds CALC_DIALECT_V3 as the dialect param", () => {
    assertTheDialectParamIsV3();
  });

  it("gives the dialect to a derived row only", () => {
    assertOnlyADerivedRowGetsTheDialect();
  });

  it("schedules a derived row, and not a measured row", () => {
    assertDerivedRowsAreScheduledAndMeasuredRowsAreNot();
  });

  it("runs a derived row every 60 s, and a measured row never", () => {
    assertDerivedRowsRunEverySixtySecondsAndMeasuredRowsNever();
  });
});

describe("E4.3 U11 — the demo water plant's post-condition", () => {
  it("pairs each asset code with its own class's template code in the params", () => {
    assertTheVerifyParamsPairEachAssetWithItsOwnTemplate();
  });

  it("reads no LIKE pattern", () => {
    assertThePostConditionReadsNoLikePattern();
  });

  it("walks the asset codes zipped with the template codes for the pinned count", () => {
    assertThePinnedCountZipsTheTwoCodeLists();
  });

  it("counts an asset as pinned only to its own class's template", () => {
    assertThePinnedCountMatchesTheAssetToItsOwnTemplate();
  });

  it("counts the template points of the five template codes exactly", () => {
    assertTheTemplatePointsCountReadsTheFiveCodes();
  });
});
