import { describe, it } from "vitest";

import { aMalformedPriorIsRefused, aMetricParsesWithAndWithoutPrior } from "./metric-catalog-values.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.317 — the metric arm's optional prior (ADR 0112 decision 8)", () => {
  it("parses a metric with and without a prior, and a null prior value", () => {
    aMetricParsesWithAndWithoutPrior();
  });

  it("refuses a prior with no asOf or a non-number value", () => {
    aMalformedPriorIsRefused();
  });
});
