import { describe, it } from "vitest";

import {
  aBucketWithoutStatsUsesItsValue,
  anHourWithNoSamplesIsNull,
  hourEdgesAreUtcUnderANonUtcZone,
  theHourIsWeightedBySampleCount,
} from "./forecast-hourly.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.4c — the forecast widget's hourly actuals (plan R10)", () => {
  it("weights each hour by sampleCount", () => {
    theHourIsWeightedBySampleCount();
  });

  it("draws an hour with no samples as a gap", () => {
    anHourWithNoSamplesIsNull();
  });

  it("falls back to v without bucket stats and skips a bad time", () => {
    aBucketWithoutStatsUsesItsValue();
  });

  it("cuts hours at UTC edges under a non-UTC zone", () => {
    hourEdgesAreUtcUnderANonUtcZone();
  });
});
