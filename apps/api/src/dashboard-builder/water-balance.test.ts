import { describe, it } from "vitest";

import {
  consumedIsIntakeMinusDischargeWithoutReuse,
  coverageCountsTheThreeColumns,
  dischargeIsTheDischargeSum,
  intakeIsTheIntakeSum,
  noDischargeAssetCoverageIsTwoOfTwo,
  noDischargeAssetReadsConsumedAsIntake,
  noIntakeAssetReadsConsumedAsNull,
  noIntakeAssetReadsIntakeAsNull,
  nonCarryingDischargeAssetIsNotInCoverage,
  nonCarryingDischargeAssetReadsConsumedAsNull,
  nonCarryingIntakeAssetKeepsTheIntakeColumn,
  nothingCarryingIsAllNullAtZeroOverZero,
  oneOfTwoDischargeAssetsCarryingReadsConsumedAsNull,
  oneOfTwoIntakeAssetsCarryingReadsConsumedAsNull,
  partlyStaleDischargeReadsConsumedAsNull,
  partlyStaleIntakeReadsConsumedAsNull,
  reuseIsTheReuseSum,
  reuseSkipsTheStaleRow,
  reuseStaleRowCountsInCarrying,
  staleDischargeCoverageIsTwoOfThree,
  staleDischargeReadsConsumedAsNull,
} from "./water-balance.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E4.3 U9 — the water balance's pure half", () => {
  it("sums intake [50] to 50", () => {
    intakeIsTheIntakeSum();
  });

  it("sums reuse [11] to 11", () => {
    reuseIsTheReuseSum();
  });

  it("sums discharge [7] to 7", () => {
    dischargeIsTheDischargeSum();
  });

  it("reads consumed as intake − discharge = 43, reuse not added (ADR 0073 decision 3)", () => {
    consumedIsIntakeMinusDischargeWithoutReuse();
  });

  it("counts coverage over intake + reuse + discharge: \"3/3\"", () => {
    coverageCountsTheThreeColumns();
  });

  it("reads consumed as intake − 0 = 50 when the site has no discharge-roled asset (Q8)", () => {
    noDischargeAssetReadsConsumedAsIntake();
  });

  it("counts coverage \"2/2\" when the site has no discharge-roled asset", () => {
    noDischargeAssetCoverageIsTwoOfTwo();
  });

  it("reads consumed as null when the one discharge asset is stale (Q8)", () => {
    staleDischargeReadsConsumedAsNull();
  });

  it("counts the stale discharge asset in carrying: \"2/3\"", () => {
    staleDischargeCoverageIsTwoOfThree();
  });

  it("reads intake as null, not 0, when no intake asset carries", () => {
    noIntakeAssetReadsIntakeAsNull();
  });

  it("reads consumed as null when intake is null (Q8)", () => {
    noIntakeAssetReadsConsumedAsNull();
  });

  it("sums reuse [null, 4] to 4", () => {
    reuseSkipsTheStaleRow();
  });

  it("counts reuse [null, 4] as \"1/2\"", () => {
    reuseStaleRowCountsInCarrying();
  });

  it("reads consumed as null for discharge [7, null] over two assets (Q8 partial staleness)", () => {
    partlyStaleDischargeReadsConsumedAsNull();
  });

  it("reads consumed as null when the one discharge-roled asset carries nothing (pre-v5)", () => {
    nonCarryingDischargeAssetReadsConsumedAsNull();
  });

  it("reads consumed as null when one of two discharge-roled assets carries nothing", () => {
    oneOfTwoDischargeAssetsCarryingReadsConsumedAsNull();
  });

  it("leaves a non-carrying discharge asset out of coverage: \"1/1\"", () => {
    nonCarryingDischargeAssetIsNotInCoverage();
  });

  it("reads consumed as null when one of two intake-roled assets carries nothing (intake ruling)", () => {
    oneOfTwoIntakeAssetsCarryingReadsConsumedAsNull();
  });

  it("reads consumed as null for intake [50, null] over two assets (intake ruling)", () => {
    partlyStaleIntakeReadsConsumedAsNull();
  });

  it("keeps the intake column at 50 when a second intake-roled asset carries nothing", () => {
    nonCarryingIntakeAssetKeepsTheIntakeColumn();
  });

  it("answers every column null and \"0/0\" when nothing carries", () => {
    nothingCarryingIsAllNullAtZeroOverZero();
  });
});
