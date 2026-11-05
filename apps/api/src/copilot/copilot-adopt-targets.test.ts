import { describe, it } from "vitest";

import {
  aGlobalAdministratorWritesEverySite,
  aMalformedListIsRefusedBeforeAnyRead,
  anAssetOfAnotherDomainIsRefused,
  anAssetOfAnotherOrganizationIsRefused,
  anAssetOutsideTheWriteScopeIsRefused,
  aNonMasterDataUserIsRefused,
  anUnpublishedVersionIsRefused,
  aPinnedAssetIsRefused,
  aPublishedVersionInScopeResolves,
  aRepeatedIdIsRefused,
  aTargetWithAnAssetOutsideTheWriteScopeIsRefused,
  aTwentySixthIdIsRefused,
  aVersionOutsideTheAllowedSetIsRefused,
  aVersionOutsideTheCallersScopeIsRefused,
  templateLessAssetsOfTheVersionAreAdmitted,
  theRecordModeResolvesTheVersionAlone,
  theResolverNamesTheVersionAndItsOrganization,
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
  it("refuses an asset of another organization", () => anAssetOfAnotherOrganizationIsRefused());
  it("refuses an asset outside the caller's write scope", () => anAssetOutsideTheWriteScopeIsRefused());
  it("lets a global administrator write every site", () => aGlobalAdministratorWritesEverySite());
});

describe("F4.312 PR 2 — the assetTemplateAdopt target's version and gate (ADR 0099 Amendment 12)", () => {
  it("resolves a published version in scope, after the route's gate in order", () => aPublishedVersionInScopeResolves());
  it("refuses a draft or archived version", () => anUnpublishedVersionIsRefused());
  it("refuses a version in no allowed organization before any access check", () => aVersionOutsideTheAllowedSetIsRefused());
  it("refuses a version outside the caller's scope before any asset read", () => aVersionOutsideTheCallersScopeIsRefused());
  it("refuses a caller who is not a master-data user", () => aNonMasterDataUserIsRefused());
  it("refuses an asset outside the write scope through the read path", () => aTargetWithAnAssetOutsideTheWriteScopeIsRefused());
  it("resolves an open wizard's record by the version alone", () => theRecordModeResolvesTheVersionAlone());
});

describe("F4.312 PR 2 — assetTemplate.adopt through the resolver (ADR 0099 Amendment 12)", () => {
  it("names the version and its organization", () => theResolverNamesTheVersionAndItsOrganization());
  it("refuses a pinned asset before the card", () => theResolverRefusesAPinnedAssetBeforeTheCard());
});
