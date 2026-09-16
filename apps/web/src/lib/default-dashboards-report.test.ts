import { describe, it } from "vitest";

import {
  backfillSummaryMatchesTheRuledSentence,
  backfillSummaryPrintsZeroCounts,
  backfillSummarySingularisesTheAssetNoun,
  instantiationSummaryCarriesTheDashboardCount,
  instantiationSummaryCarriesTheRuleCount,
  instantiationSummaryMatchesTheRuledSentence,
  instantiationSummaryOmitsTheDisabledRuleCount,
  instantiationSummaryPrintsZeroCounts,
  instantiationSummarySingularisesEveryNoun,
} from "./default-dashboards-report.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.2 default-dashboards report sentences", () => {
  it("prints ADR 0067 Q5's instantiate sentence verbatim", () => {
    instantiationSummaryMatchesTheRuledSentence();
  });

  it("carries the dashboard count", () => {
    instantiationSummaryCarriesTheDashboardCount();
  });

  it("carries the rule count", () => {
    instantiationSummaryCarriesTheRuleCount();
  });

  it("singularises every noun at a count of one", () => {
    instantiationSummarySingularisesEveryNoun();
  });

  it("prints zero counts rather than dropping the clause", () => {
    instantiationSummaryPrintsZeroCounts();
  });

  it("leaves the disabled-rule count out of the sentence", () => {
    instantiationSummaryOmitsTheDisabledRuleCount();
  });

  it("prints the backfill sentence verbatim", () => {
    backfillSummaryMatchesTheRuledSentence();
  });

  it("singularises the backfill's asset noun only", () => {
    backfillSummarySingularisesTheAssetNoun();
  });

  it("prints the backfill's zero counts", () => {
    backfillSummaryPrintsZeroCounts();
  });
});
