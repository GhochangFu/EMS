import { describe, it } from "vitest";

import {
  a409WithAPlainMessageIsNotARefusalBody,
  aBatchAboveTheCapDisablesTheBulkAction,
  aBatchOfTwoDomainsOffersNothing,
  aBatchOfTwoDomainsSaysWhy,
  aBatchOfTwoOrganizationsOffersNothing,
  aBatchOfTwoOrganizationsSaysWhy,
  aMatchingVersionHasNoReason,
  aNon409IsNotARefusalBody,
  aNonJsonErrorIsNotARefusalBody,
  aPinnedAssetDisablesTheBulkAction,
  aTemplateLessSelectionEnablesTheBulkAction,
  aVersionOfAnotherDomainIsNotOffered,
  aVersionOfAnotherOrganizationIsNotOffered,
  aWholeAssetRefusalHasNoKeySlot,
  anEmptyGroupIsLeftOut,
  anEmptySelectionDisablesTheBulkAction,
  confirmFollowsCanApplyNotTheRefusalList,
  confirmIsDisabledWhenTheServerRefuses,
  confirmIsDisabledWithNoPreview,
  confirmIsEnabledWhenTheServerCanApply,
  inheritedDefaultsAreAPlainNotice,
  noMatchingVersionSaysWhy,
  onlyAPublishedVersionIsOffered,
  the409BodyYieldsItsRefusals,
  theBulkRefusalNamesThePinnedAsset,
  thePlanIsGroupedKeptAddedConvertedSkipped,
  theRefusalSentenceNamesTheAssetCode,
  theRefusalSentenceNamesThePointKey,
} from "./template-adoption.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.312 — template adoption: the picker filter, the plan and the refusals", () => {
  it("offers only a published version", () => onlyAPublishedVersionIsOffered());
  it("offers no version of another organization", () => aVersionOfAnotherOrganizationIsNotOffered());
  it("offers no version of another domain", () => aVersionOfAnotherDomainIsNotOffered());
  it("offers nothing to a batch of two organizations", () => aBatchOfTwoOrganizationsOffersNothing());
  it("says why a batch of two organizations has no version", () => aBatchOfTwoOrganizationsSaysWhy());
  it("offers nothing to a batch of two domains", () => aBatchOfTwoDomainsOffersNothing());
  it("says why a batch of two domains has no version", () => aBatchOfTwoDomainsSaysWhy());
  it("says why when no version matches", () => noMatchingVersionSaysWhy());
  it("gives no reason when a version matches", () => aMatchingVersionHasNoReason());
  it("disables the bulk action when a selected asset is pinned", () => aPinnedAssetDisablesTheBulkAction());
  it("names the pinned asset in the bulk refusal", () => theBulkRefusalNamesThePinnedAsset());
  it("disables the bulk action above the cap", () => aBatchAboveTheCapDisablesTheBulkAction());
  it("disables the bulk action with nothing selected", () => anEmptySelectionDisablesTheBulkAction());
  it("enables the bulk action for a template-less selection", () => aTemplateLessSelectionEnablesTheBulkAction());
  it("groups a plan into kept, added, converted and skipped", () => thePlanIsGroupedKeptAddedConvertedSkipped());
  it("leaves an empty group out", () => anEmptyGroupIsLeftOut());
  it("states inherited defaults as a plain notice", () => inheritedDefaultsAreAPlainNotice());
  it("names the asset code in a refusal sentence", () => theRefusalSentenceNamesTheAssetCode());
  it("names the point key in a refusal sentence", () => theRefusalSentenceNamesThePointKey());
  it("leaves the key slot out of a whole-asset refusal", () => aWholeAssetRefusalHasNoKeySlot());
  it("disables Confirm with no preview", () => confirmIsDisabledWithNoPreview());
  it("disables Confirm when the server refuses", () => confirmIsDisabledWhenTheServerRefuses());
  it("takes Confirm from canApply, not from the capped refusal list", () => confirmFollowsCanApplyNotTheRefusalList());
  it("enables Confirm when the server can apply", () => confirmIsEnabledWhenTheServerCanApply());
  it("reads the refusals out of the adopt 409 body", () => the409BodyYieldsItsRefusals());
  it("reads a plain-message 409 as no refusal body", () => a409WithAPlainMessageIsNotARefusalBody());
  it("reads a non-409 as no refusal body", () => aNon409IsNotARefusalBody());
  it("reads a non-JSON error as no refusal body", () => aNonJsonErrorIsNotARefusalBody());
});
