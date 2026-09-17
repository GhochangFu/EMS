import { describe, it } from "vitest";

import {
  aChosenAssetGroupIsChosen,
  aLocationDashboardPrefillsAsLocation,
  aLocationValueYieldsTheLocationColumn,
  aScopelessDashboardPrefillsAsOrganization,
  anAssetGroupDashboardPrefillsAsAssetGroup,
  anAssetGroupValueYieldsTheGroupColumn,
  anOrganizationValueYieldsTwoNulls,
  anUnchosenAssetGroupIsNotChosen,
  theOtherTwoKindsAreChosenByTheirOwnId,
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

  it("reads the organization and location kinds as chosen by their own id", () => {
    theOtherTwoKindsAreChosenByTheirOwnId();
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
});
