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
