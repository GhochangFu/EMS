import { describe, it } from "vitest";

import {
  aCreateWithoutAnAssetIsRefusedByTheModelBody,
  aRefusedCheckStoresNothingAndReturnsTheRoutesSentence,
  aRefusedTargetNeverRunsTheCheck,
  aRuleProposalInAFollowUpTurnIsAccepted,
  aRuleProposalWithoutTheCheckServiceIsRefused,
  anUpdateOfADraftHasNoLiveLine,
  anUpdateOfAPublishedRuleCarriesTheLiveLine,
  theCheckedIdsAreTheCatalogsRuleEntries,
  theCheckIsAskedWithTheResolvedOrganization,
  theDisableToolStoresEnabledFalseWithItsHashAndIsRed,
  theEnableToolDefinesNoBodyAndStoresEnabledTrue,
  thePublishSummaryCarriesTheLiveLine,
  theRuleToolsAreInEveryCopilotRolesRegistry,
  theStoredSummaryCarriesTheCheckNote,
} from "./copilot-propose-rules.spec";

/** `F4.278` — Vitest entry point for the rule propose tools. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.278 — the copilot proposes alarm-rule writes (ADR 0099 Amendment 8)", () => {
  it("the rule tools are in every copilot role's registry", () => theRuleToolsAreInEveryCopilotRolesRegistry());
  it("a rule proposal without the check service is refused", () => aRuleProposalWithoutTheCheckServiceIsRefused());
  it("a refused check stores nothing and returns the route's sentence", () =>
    aRefusedCheckStoresNothingAndReturnsTheRoutesSentence());
  it("the check is asked with the resolved organization", () => theCheckIsAskedWithTheResolvedOrganization());
  it("the stored summary carries the check's note", () => theStoredSummaryCarriesTheCheckNote());
  it("the enable tool defines no body and stores enabled true", () => theEnableToolDefinesNoBodyAndStoresEnabledTrue());
  it("the disable tool stores enabled false with its hash and is red", () =>
    theDisableToolStoresEnabledFalseWithItsHashAndIsRed());
  it("the publish summary carries the live line", () => thePublishSummaryCarriesTheLiveLine());
  it("an update of a published rule carries the live line", () => anUpdateOfAPublishedRuleCarriesTheLiveLine());
  it("an update of a draft has no live line", () => anUpdateOfADraftHasNoLiveLine());
  it("a create without an asset is refused by the model body", () => aCreateWithoutAnAssetIsRefusedByTheModelBody());
  it("a refused target never runs the check", () => aRefusedTargetNeverRunsTheCheck());
  it("the checked ids are the catalog's rule-targeted entries", () => theCheckedIdsAreTheCatalogsRuleEntries());
  it("a rule proposal in a follow-up turn is accepted", () => aRuleProposalInAFollowUpTurnIsAccepted());
});
