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
} from "./copilot-adopt-targets.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.312 PR 2 — the assetTemplateAdopt target's ids (ADR 0099 Amendment 12)", () => {
  it("admits twenty-five distinct ids", () => twentyFiveIdsAreAdmitted());
  it("refuses a twenty-sixth id", () => aTwentySixthIdIsRefused());
  it("refuses an id listed twice", () => aRepeatedIdIsRefused());
  it("refuses a malformed list before any read", () => aMalformedListIsRefusedBeforeAnyRead());
});

describe("F4.312 PR 2 — the assetTemplateAdopt target's assets (ADR 0099 Amendment 12)", () => {
  it("admits template-less assets of the version's organization and domain at writable sites", () =>
    templateLessAssetsOfTheVersionAreAdmitted());
  it("refuses a pinned asset", () => aPinnedAssetIsRefused());
  it("refuses an asset of another domain", () => anAssetOfAnotherDomainIsRefused());
  it("refuses a read row of another organization", () => aReadRowOfAnotherOrganizationIsRefused());
  it("refuses a listed id the organization-filtered read did not return", () => aListedIdTheReadDidNotReturnIsRefused());
  it("refuses an asset outside the caller's write scope", () => anAssetOutsideTheWriteScopeIsRefused());
  it("lets a global administrator write every site", () => aGlobalAdministratorWritesEverySite());
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
  it("refuses a pinned asset before the card", () => theResolverRefusesAPinnedAssetBeforeTheCard());
  it("resolves the version and its organization in record mode", () => theResolverRecordModeResolvesTheVersion());
});
