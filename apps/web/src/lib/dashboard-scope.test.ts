import { describe, it } from "vitest";

import {
  aChosenAssetGroupIsChosen,
  aChosenAssetIsChosen,
  aLocationAbsentFromTheOfferedListIsNotOffered,
  aLocationInTheOfferedListIsOffered,
  anAssetGroupAbsentFromTheOfferedListIsNotOffered,
  anAssetGroupInTheOfferedListIsOffered,
  anAssetValueIsAlwaysOffered,
  anOrganizationValueIsAlwaysOffered,
  aDifferentAssetGroupValueIsChanged,
  aDifferentLocationValueIsChanged,
  aGroupValuePatchesToItsColumn,
  aLocationDashboardPrefillsAsLocation,
  aLocationValueYieldsTheLocationColumn,
  anAssetScopedDashboardPrefillsAsAsset,
  anAssetValueIsNeverChanged,
  anAssetValuePatchesToNoKeys,
  aScopelessAssetlessDashboardStillPrefillsAsOrganization,
  aScopelessDashboardPrefillsAsOrganization,
  anAssetGroupDashboardPrefillsAsAssetGroup,
  anAssetGroupValueYieldsTheGroupColumn,
  anOrganizationValueYieldsTwoNulls,
  anUnchosenAssetGroupIsNotChosen,
  anUnchosenAssetIsNotChosen,
  aChosenOrganizationIsChosen,
  anUnchosenOrganizationIsNotChosen,
  aChosenLocationIsChosen,
  anUnchosenLocationIsNotChosen,
  duplicatingAnAssetGroupScopedDashboardKeepsItsGroup,
  duplicatingAnAssetScopedDashboardFoldsToOrganization,
  scopeAssetGroupOptionsFiltersByOrganization,
  scopeAssetGroupOptionsMapsTheGroupAndItsLocationName,
  scopeAssetGroupOptionsNullsAMissingLocation,
} from "./dashboard-scope.spec";

/** Vitest entry point — see `apps/web/src/lib/dashboard-duplicate.test.ts` (ADR 0014). */
describe("F3.34 dashboard scope model", () => {
  it("prefills an asset-group dashboard as the assetGroup kind", () => {
    anAssetGroupDashboardPrefillsAsAssetGroup();
  });

  it("prefills a location dashboard as the location kind", () => {
    aLocationDashboardPrefillsAsLocation();
  });

  it("prefills a scopeless dashboard as organization-wide", () => {
    aScopelessDashboardPrefillsAsOrganization();
  });

  it("reads an assetGroup value with an empty id as not chosen", () => {
    anUnchosenAssetGroupIsNotChosen();
  });

  it("reads an assetGroup value with an id as chosen", () => {
    aChosenAssetGroupIsChosen();
  });

  it("reads an organization value with an id as chosen", () => {
    aChosenOrganizationIsChosen();
  });

  it("reads an organization value with an empty id as not chosen", () => {
    anUnchosenOrganizationIsNotChosen();
  });

  it("reads a location value with an id as chosen", () => {
    aChosenLocationIsChosen();
  });

  it("reads a location value with an empty locationId as not chosen", () => {
    anUnchosenLocationIsNotChosen();
  });

  it("carries an assetGroup value as assetGroupId with locationId null", () => {
    anAssetGroupValueYieldsTheGroupColumn();
  });

  it("carries a location value as locationId with assetGroupId null", () => {
    aLocationValueYieldsTheLocationColumn();
  });

  it("carries an organization-wide value as two nulls", () => {
    anOrganizationValueYieldsTwoNulls();
  });

  it("prefills an asset-scoped dashboard as the asset kind", () => {
    anAssetScopedDashboardPrefillsAsAsset();
  });

  it("still prefills a scopeless, asset-less dashboard as organization-wide", () => {
    aScopelessAssetlessDashboardStillPrefillsAsOrganization();
  });

  it("folds an asset-scoped source to organization-wide when duplicating", () => {
    duplicatingAnAssetScopedDashboardFoldsToOrganization();
  });

  it("keeps a group-scoped source's group when duplicating", () => {
    duplicatingAnAssetGroupScopedDashboardKeepsItsGroup();
  });

  it("reads an asset value with an id as chosen", () => {
    aChosenAssetIsChosen();
  });

  it("reads an asset value with an empty id as not chosen", () => {
    anUnchosenAssetIsNotChosen();
  });

  it("patches an asset value to an empty object with no keys", () => {
    anAssetValuePatchesToNoKeys();
  });

  it("still patches a group value to its own column", () => {
    aGroupValuePatchesToItsColumn();
  });

  it("never reads an asset value as changed", () => {
    anAssetValueIsNeverChanged();
  });

  it("reads a different location value as changed", () => {
    aDifferentLocationValueIsChanged();
  });

  it("reads a different asset-group value as changed", () => {
    aDifferentAssetGroupValueIsChanged();
  });

  it("maps a group's fields with its joined location's name", () => {
    scopeAssetGroupOptionsMapsTheGroupAndItsLocationName();
  });

  it("nulls a group's locationName when its location is missing from the scope", () => {
    scopeAssetGroupOptionsNullsAMissingLocation();
  });

  it("filters asset-group options by organizationId", () => {
    scopeAssetGroupOptionsFiltersByOrganization();
  });

  it("always offers an organization value", () => {
    anOrganizationValueIsAlwaysOffered();
  });

  it("always offers an asset value", () => {
    anAssetValueIsAlwaysOffered();
  });

  it("offers a location present in the offered list", () => {
    aLocationInTheOfferedListIsOffered();
  });

  it("does not offer a location absent from the offered list", () => {
    aLocationAbsentFromTheOfferedListIsNotOffered();
  });

  it("offers a group present in the offered list", () => {
    anAssetGroupInTheOfferedListIsOffered();
  });

  it("does not offer a group absent from the offered list", () => {
    anAssetGroupAbsentFromTheOfferedListIsNotOffered();
  });
});
