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
  aChosenOrganizationIsChosen,
  anUnchosenOrganizationIsNotChosen,
  aChosenLocationIsChosen,
  anUnchosenLocationIsNotChosen,
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
});
