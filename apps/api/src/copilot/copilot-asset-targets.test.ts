import { describe, it } from "vitest";

import {
  aCreatesAssetInNoAllowedOrganizationIsNull,
  aCreatesAssetIsNamedByItsLabel,
  aGroupMemberIsNamedByItsAssetsLabel,
  aMissingAssetIsNull,
  anAssetWithAnRtuIsNamedByCodeAndRtu,
  anAssetWithNoRtuIsNamedByCodeAndLocation,
  theTargetKeepsItsTemplateAndPointKeys,
} from "./copilot-asset-targets.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.316 PR 7 — the copilot's asset target is named by the asset label (ADR 0111, Q4)", () => {
  it("names an asset with an RTU <code> · <RTU>", () => anAssetWithAnRtuIsNamedByCodeAndRtu());
  it("names an asset with no RTU <code> · <location>", () => anAssetWithNoRtuIsNamedByCodeAndLocation());
  it("keeps the organization, the pinned version and the point keys", () => theTargetKeepsItsTemplateAndPointKeys());
  it("is null for an asset not found in the organization", () => aMissingAssetIsNull());
  it("names a rule, maintenance or work-order create's asset by its label", () => aCreatesAssetIsNamedByItsLabel());
  it("is null for a create's asset in no allowed organization", () => aCreatesAssetInNoAllowedOrganizationIsNull());
  it("names a group membership <asset label> in <group>", () => aGroupMemberIsNamedByItsAssetsLabel());
});
