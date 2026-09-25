import { describe, it } from "vitest";

import {
  dataQualityBandFairAtThreshold,
  dataQualityBandFairJustBelowGood,
  dataQualityBandGoodAtThreshold,
  dataQualityBandNullForNaN,
  dataQualityBandNullForNull,
  dataQualityBandPoorJustBelowFair,
  summaryLineAllOperational,
  summaryLineListsDegradedLabelsInOrder,
  titleLineJoinsLabelAndStateWithSpacedUnderscore,
} from "./system-status-bands.spec";

/** Vitest entry point — see `apps/web/src/lib/alarm-severity.test.ts` (ADR 0014). */
describe("system-status-bands", () => {
  it("bands 95 as Good, the threshold itself", () => {
    dataQualityBandGoodAtThreshold();
  });

  it("bands 94.9 as Fair, just below the Good threshold", () => {
    dataQualityBandFairJustBelowGood();
  });

  it("bands 80 as Fair, the threshold itself", () => {
    dataQualityBandFairAtThreshold();
  });

  it("bands 79.9 as Poor, just below the Fair threshold", () => {
    dataQualityBandPoorJustBelowFair();
  });

  it("bands null as null — nothing to measure", () => {
    dataQualityBandNullForNull();
  });

  it("bands NaN as null, failing closed rather than defaulting to Poor", () => {
    dataQualityBandNullForNaN();
  });

  it("summarises an all-ok status as All systems operational", () => {
    summaryLineAllOperational();
  });

  it("summarises a degraded status by listing the degraded components' labels", () => {
    summaryLineListsDegradedLabelsInOrder();
  });

  it("joins label and state with a middle dot, underscore turned to space", () => {
    titleLineJoinsLabelAndStateWithSpacedUnderscore();
  });
});
