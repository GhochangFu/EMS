import { describe, it } from "vitest";

import {
  anEmptyScopeReadsNothing,
  noForecastRowSkipsTheMeansAndRules,
  theAnomalySummaryReadsTheAggregateThenTheOrganizations,
  theForecastSummaryReadsInOrderOnOneTransaction,
} from "./ml-findings.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9a — MlFindingsService (ADR 0135 Amendment 8, plan T1.6)", () => {
  it("the forecast summary: findings, means, rules, organizations, in order on one transaction", () =>
    theForecastSummaryReadsInOrderOnOneTransaction());
  it("no forecast row: the means and rule reads are skipped", () => noForecastRowSkipsTheMeansAndRules());
  it("an empty scope reads nothing", () => anEmptyScopeReadsNothing());
  it("the anomaly summary: the aggregate, then the organizations", () =>
    theAnomalySummaryReadsTheAggregateThenTheOrganizations());
});
