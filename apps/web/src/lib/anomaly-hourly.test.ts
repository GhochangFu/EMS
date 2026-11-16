import { describe, it } from "vitest";

import {
  anUnscoredHourStaysAGap,
  eachHourTakesTheLargerDetector,
  hourEdgesAreUtcUnderANonUtcZone,
} from "./anomaly-hourly.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.2d — the anomaly widget's hourly score line", () => {
  it("takes the larger of the two detector scores", () => {
    eachHourTakesTheLargerDetector();
  });

  it("seeds every hour of the window, so an unscored hour is a gap", () => {
    anUnscoredHourStaysAGap();
  });

  it("cuts hours at UTC edges under a non-UTC zone", () => {
    hourEdgesAreUtcUnderANonUtcZone();
  });
});
