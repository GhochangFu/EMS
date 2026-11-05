import { describe, it } from "vitest";

import { listedUnitFreshnessFollowsTheAssetsHeadlinePoints, noSampleAnywhereReadsNone } from "./mimic-nodes.freshness.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.307 — a listed unit's freshness follows its asset", () => {
  it("P1 a unit listing only a key the asset lacks reads the headline sample's freshness", () => {
    listedUnitFreshnessFollowsTheAssetsHeadlinePoints();
  });
  it("P2 no sample anywhere reads none", () => {
    noSampleAnywhereReadsNone();
  });
});
