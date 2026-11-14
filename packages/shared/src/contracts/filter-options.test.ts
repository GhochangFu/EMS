import { describe, it } from "vitest";

import * as spec from "./filter-options.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.361 — the filter-options response contract (ADR 0132)", () => {
  it("a full payload parses", () => spec.assertAFullPayloadParses());
  it("a location without organizationId fails", () => spec.assertALocationWithoutOrganizationIdFails());
  it("parentId undefined fails, null parses", () => spec.assertParentIdIsNullableNotOptional());
  it("an asset group without assetIds fails", () => spec.assertAGroupWithoutAssetIdsFails());
  it("an asset without organizationId fails", () => spec.assertAnAssetWithoutOrganizationIdFails());
});
