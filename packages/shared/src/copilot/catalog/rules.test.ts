import { describe, it } from "vitest";

import {
  noRuleEntryNarrowsTheRoles,
  noRuleEntryTakesAPrecondition,
  theArchiveEntryIsRed,
  theCreateModelBodyRequiresAnAsset,
  theDirectionEntriesHaveFixedBodiesAndNoSteps,
  theDisableSummaryHasNoLiveLine,
  theDuplicateSummarySaysDraftCopyAndNoLinks,
  thePublishAndEnableSummariesCarryTheLiveLine,
  theRuleTargetsMirrorTheRoute,
  theSevenRuleEntriesNameTheirRoutes,
  theTwoRuleRoutesAreExcludedWithTheirReasons,
  theUpdateSummaryCarriesTheLiveLineForAPublishedRule,
  theUpdateSummaryOfADraftHasNoLiveLine,
  noOtherRuleEntryIsFlaggedRed,
  theBatchEntryIsRedWithRiskCreate,
  theBatchEntryNamesItsRouteAndBodies,
  theBatchExcludedRowsAreClientOnlyAndChecksCardOnly,
  theBatchSummaryCountsRulesAndAssetsAndCarriesTheLiveLine,
  theBatchSummaryNeverStatesTheAppliedCount,
  theBatchTargetIsTheRows,
} from "./rules.spec";

/** `F4.278` — Vitest entry point for the alarm-rule catalog entries. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.278 — alarm-rule catalog entries (ADR 0099 Amendment 8)", () => {
  it("the seven entries name their routes and bodies", () => {
    theSevenRuleEntriesNameTheirRoutes();
  });

  it("the direction entries have fixed bodies and no steps", () => {
    theDirectionEntriesHaveFixedBodiesAndNoSteps();
  });

  it("the archive entry is red", () => {
    theArchiveEntryIsRed();
  });

  it("the publish and enable summaries carry the live line", () => {
    thePublishAndEnableSummariesCarryTheLiveLine();
  });

  it("an update of a published rule carries the live line", () => {
    theUpdateSummaryCarriesTheLiveLineForAPublishedRule();
  });

  it("an update of a draft carries no live line", () => {
    theUpdateSummaryOfADraftHasNoLiveLine();
  });

  it("the disable summary carries no live line", () => {
    theDisableSummaryHasNoLiveLine();
  });

  it("the duplicate summary says draft copy and no channel links", () => {
    theDuplicateSummarySaysDraftCopyAndNoLinks();
  });

  it("the rule targets mirror the route", () => {
    theRuleTargetsMirrorTheRoute();
  });

  it("the create model body requires an asset", () => {
    theCreateModelBodyRequiresAnAsset();
  });

  it("no rule entry takes a precondition", () => {
    noRuleEntryTakesAPrecondition();
  });

  it("no rule entry narrows the roles", () => {
    noRuleEntryNarrowsTheRoles();
  });

  it("the two rule routes are excluded with their reasons", () => {
    theTwoRuleRoutesAreExcludedWithTheirReasons();
  });
});

/** `F4.289` — the batch entry (ADR 0099 Amendment 9 E3). Assertions live in the sibling `.spec` (§4.6). */
describe("F4.289 — rule.createBatch catalog entry", () => {
  it("the batch entry names its route and bodies", () => theBatchEntryNamesItsRouteAndBodies());
  it("excludedRows is client-only and checks card-only", () => theBatchExcludedRowsAreClientOnlyAndChecksCardOnly());
  it("the batch entry is red with risk create (ruling P2)", () => theBatchEntryIsRedWithRiskCreate());
  it("no other rule entry is flagged red", () => noOtherRuleEntryIsFlaggedRed());
  it("the batch target is the rows", () => theBatchTargetIsTheRows());
  it("the batch summary counts rules and assets and carries the live line", () => theBatchSummaryCountsRulesAndAssetsAndCarriesTheLiveLine());
  it("the batch summary never states the applied count", () => theBatchSummaryNeverStatesTheAppliedCount());
});
