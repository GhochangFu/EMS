import { describe, it } from "vitest";

import {
  aMalformedAssetIdAnswersTheMalformedSentence,
  aMalformedVersionIdAnswersTheMalformedSentence,
  anEmptyVersionIdIsStillAnArgumentError,
  anOrganizationRefusalNamesBothOrganizations,
  aPinnedRefusalNamesTheVersionsOrganization,
  anAssetFoundNowhereAnswersTheGeneralSentence,
  aPinnedAssetAnswersThePinnedSentence,
  aPinnedAssetStoresNoChange,
} from "./copilot-propose-adopt-refusal.spec";

/** `F4.315` PR A — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.315 PR A — assetTemplate.adopt's refusal through the propose tool (ADR 0099 Amendment 14)", () => {
  it("answers a pinned asset in scope with the pinned sentence", () => aPinnedAssetAnswersThePinnedSentence());
  it("stores no change for a pinned asset", () => aPinnedAssetStoresNoChange());
  it("keeps the general sentence for an asset found nowhere", () => anAssetFoundNowhereAnswersTheGeneralSentence());
  it("names the version's organization on a pinned refusal", () => aPinnedRefusalNamesTheVersionsOrganization());
  it("names both organizations on an organization refusal", () => anOrganizationRefusalNamesBothOrganizations());
  it("answers a non-UUID version id with the malformed sentence", () => aMalformedVersionIdAnswersTheMalformedSentence());
  it("answers a non-UUID asset id with the malformed sentence", () => aMalformedAssetIdAnswersTheMalformedSentence());
  it("still refuses an empty version id at the argument guard", () => anEmptyVersionIdIsStillAnArgumentError());
});
