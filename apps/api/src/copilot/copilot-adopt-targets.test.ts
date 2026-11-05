import { describe, it } from "vitest";

import {
  aDraftVersionResolvesWithItsStatus,
  aGlobalAdministratorWritesEverySite,
  aListedIdTheReadDidNotReturnIsRefused,
  aMalformedListIsRefusedBeforeAnyRead,
  anArchivedVersionResolvesWithItsStatus,
  anAssetOfAnotherDomainIsRefused,
  anAssetOutsideTheWriteScopeIsRefused,
  aNonMasterDataUserIsRefused,
  aNonMasterDataUserReadsNothing,
  anUnpublishedVersionsAssetsAreNotRead,
  aPinnedAssetIsRefused,
  aPublishedVersionInScopeResolves,
  aReadRowOfAnotherOrganizationIsRefused,
  aRepeatedIdIsRefused,
  aTargetWithAnAssetOutsideTheWriteScopeIsRefused,
  aTwentySixthIdIsRefused,
  aVersionOutsideTheAllowedSetAsksNoOrganizationCheck,
  aVersionOutsideTheAllowedSetIsRefused,
  aVersionOutsideTheCallersScopeIsRefused,
  aVersionOutsideTheCallersScopeReadsNoAsset,
  templateLessAssetsOfTheVersionAreAdmitted,
  theGateRunsInTheRoutesOrder,
  theRecordModeReadsNoAsset,
  theRecordModeResolvesTheVersionAlone,
  theResolverCarriesTheVersionsStatus,
  theResolverNamesTheVersionAndItsOrganization,
  theResolverRecordModeResolvesTheVersion,
  theResolverRefusesAPinnedAssetBeforeTheCard,
  twentyFiveIdsAreAdmitted,
  aNonUuidAssetIdIsTheMalformedSentence,
  anOutOfScopeAssetOutranksAPinnedOne,
  aPinnedAssetInScopeNamesItsCause,
  thePinnedSentenceNamesTheAssetAndTheVersion,
  anAssetOfAnotherDomainInScopeNamesItsCause,
  anAssetOfAnotherAllowedOrganizationNamesItsCause,
  anIdFoundNowhereKeepsTheGeneralRefusal,
  anAssetOutsideTheWriteScopeNamesNoCause,
  aMalformedVersionIdIsTheMalformedSentence,
  aMalformedVersionIdReadsNothing,
  theMalformedSentenceNamesTheReadTools,
  theMissingIdsAreReadOncePerOtherOrganization,
} from "./copilot-adopt-targets.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.312 PR 2 — the assetTemplateAdopt target's ids (ADR 0099 Amendment 12)", () => {
  it("admits twenty-five distinct ids", () => twentyFiveIdsAreAdmitted());
  it("refuses a twenty-sixth id", () => aTwentySixthIdIsRefused());
  it("refuses an id listed twice", () => aRepeatedIdIsRefused());
  it("refuses a malformed list before any read", () => aMalformedListIsRefusedBeforeAnyRead());
  it("answers a non-UUID asset id with the malformed sentence", () => aNonUuidAssetIdIsTheMalformedSentence());
});

describe("F4.312 PR 2 — the assetTemplateAdopt target's assets (ADR 0099 Amendment 12)", () => {
  it("admits template-less assets of the version's organization and domain at writable sites", () =>
    templateLessAssetsOfTheVersionAreAdmitted());
  it("refuses a pinned asset by name", () => aPinnedAssetIsRefused());
  it("refuses an asset of another domain by name", () => anAssetOfAnotherDomainIsRefused());
  it("refuses a read row of another organization by name", () => aReadRowOfAnotherOrganizationIsRefused());
  it("refuses a listed id no read returned with the general refusal", () => aListedIdTheReadDidNotReturnIsRefused());
  it("refuses an asset outside the caller's write scope with the general refusal", () => anAssetOutsideTheWriteScopeIsRefused());
  it("names no cause while any asset is out of scope", () => anOutOfScopeAssetOutranksAPinnedOne());
  it("lets a global administrator write every site", () => aGlobalAdministratorWritesEverySite());
});

describe("F4.315 PR A — the adopt target names its cause in scope (ADR 0099 Amendment 14)", () => {
  it("words a pinned asset in scope with the pinned sentence", () => aPinnedAssetInScopeNamesItsCause());
  it("names the asset code and the version in the pinned sentence", () => thePinnedSentenceNamesTheAssetAndTheVersion());
  it("words an asset of another domain with the domain sentence", () => anAssetOfAnotherDomainInScopeNamesItsCause());
  it("words an asset of another allowed organization with the organization sentence", () =>
    anAssetOfAnotherAllowedOrganizationNamesItsCause());
  it("reads the missing ids once per other allowed organization", () => theMissingIdsAreReadOncePerOtherOrganization());
  it("keeps the general refusal for an id found nowhere", () => anIdFoundNowhereKeepsTheGeneralRefusal());
  it("names no cause for an asset outside the write scope", () => anAssetOutsideTheWriteScopeNamesNoCause());
  it("answers a non-UUID version id with the malformed sentence", () => aMalformedVersionIdIsTheMalformedSentence());
  it("reads nothing for a non-UUID version id", () => aMalformedVersionIdReadsNothing());
  it("points the malformed sentence to the two read tools", () => theMalformedSentenceNamesTheReadTools());
});

describe("F4.312 PR 2 — the assetTemplateAdopt target's version and gate (ADR 0099 Amendment 12)", () => {
  it("resolves a published version in scope with its status", () => aPublishedVersionInScopeResolves());
  it("runs the route's gate in its order", () => theGateRunsInTheRoutesOrder());
  it("resolves a draft version with its status, for the lifecycle mirror", () => aDraftVersionResolvesWithItsStatus());
  it("resolves an archived version with its status, for the lifecycle mirror", () => anArchivedVersionResolvesWithItsStatus());
  it("reads no asset of an unpublished version", () => anUnpublishedVersionsAssetsAreNotRead());
  it("refuses a version in no allowed organization", () => aVersionOutsideTheAllowedSetIsRefused());
  it("asks no organization check for a version in no allowed organization", () =>
    aVersionOutsideTheAllowedSetAsksNoOrganizationCheck());
  it("refuses a version outside the caller's scope", () => aVersionOutsideTheCallersScopeIsRefused());
  it("reads no asset for a version outside the caller's scope", () => aVersionOutsideTheCallersScopeReadsNoAsset());
  it("refuses a caller who is not a master-data user", () => aNonMasterDataUserIsRefused());
  it("reads nothing for a caller who is not a master-data user", () => aNonMasterDataUserReadsNothing());
  it("refuses an asset outside the write scope through the read path", () => aTargetWithAnAssetOutsideTheWriteScopeIsRefused());
  it("resolves an open wizard's record by the version alone", () => theRecordModeResolvesTheVersionAlone());
  it("reads no asset for an open wizard's record", () => theRecordModeReadsNoAsset());
});

describe("F4.312 PR 2 — assetTemplate.adopt through the resolver (ADR 0099 Amendment 12)", () => {
  it("names the version and its organization", () => theResolverNamesTheVersionAndItsOrganization());
  it("carries the version's status", () => theResolverCarriesTheVersionsStatus());
  it("refuses a pinned asset before the card, by name", () => theResolverRefusesAPinnedAssetBeforeTheCard());
  it("resolves the version and its organization in record mode", () => theResolverRecordModeResolvesTheVersion());
});
