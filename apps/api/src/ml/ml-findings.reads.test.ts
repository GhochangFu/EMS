import { describe, it } from "vitest";

import {
  aTextArrayQuotesEveryElement,
  everyAssetFilterIsPresentWheneverIdsAreGiven,
  theAnomalyFindingsAggregateCountsAnHourOnceAtTheLine,
  theFindingsReadsUseTheListsChains,
  theForecastFindingsReadBoundsTheWindowAndFencesBothLaterals,
  theMeansReadCoversTheLast24Hours,
  theOrganizationReadsTakeOneRowPerRun,
  theRuleReadCarriesTheOrganizationAndTheCoveredShapes,
  theRunnersUseTheTransactionTheyAreGiven,
} from "./ml-findings.reads.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9a — the findings statements (ADR 0135 Amendment 8, plan T1.5)", () => {
  it("S1: every asset filter is present whenever ids are given ([] included), absent only for null", () =>
    everyAssetFilterIsPresentWheneverIdsAreGiven());
  it("the findings reads reuse the lists' run chains verbatim", () => theFindingsReadsUseTheListsChains());
  it("the forecast findings read: 48 hours from the current hour, both laterals fenced", () =>
    theForecastFindingsReadBoundsTheWindowAndFencesBothLaterals());
  it("the means read covers the 24 hours before the current hour", () => theMeansReadCoversTheLast24Hours());
  it("a text[] literal quotes every element", () => aTextArrayQuotesEveryElement());
  it("the rule read carries the organization by hand and only the covered shapes", () =>
    theRuleReadCarriesTheOrganizationAndTheCoveredShapes());
  it("the anomaly aggregate: ANOMALY_UNUSUAL_SCORE bound with >=; an hour two detectors mark counts once", () =>
    theAnomalyFindingsAggregateCountsAnHourOnceAtTheLine());
  it("the organization reads take one fenced row per run", () => theOrganizationReadsTakeOneRowPerRun());
  it("the runners use the transaction they are given; no pair reads nothing", () =>
    theRunnersUseTheTransactionTheyAreGiven());
});
