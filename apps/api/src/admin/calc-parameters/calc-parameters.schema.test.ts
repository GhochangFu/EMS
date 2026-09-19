import { describe, it } from "vitest";

import {
  assertAKeyWithAHyphenIsRefused,
  assertANonFiniteValueIsRefused,
  assertAnExtraFieldIsRefused,
  assertAValidOrganizationScopedCreateParses,
  assertBothScopesAreRefusedAtAssetId,
  assertEffectiveToMustFollowEffectiveFrom,
  assertTheListQueryRequiresAnOrganization,
} from "./calc-parameters.schema.spec";

/** `E4.1a` U8 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("E4.1a — calc parameter body contract", () => {
  it("parses a valid organization-scoped create", () => {
    assertAValidOrganizationScopedCreateParses();
  });

  it("refuses both scopes at once, at assetId", () => {
    assertBothScopesAreRefusedAtAssetId();
  });

  it("refuses effectiveTo <= effectiveFrom, at effectiveTo, on both bodies", () => {
    assertEffectiveToMustFollowEffectiveFrom();
  });

  it("refuses a key outside ^[a-z][a-z0-9_]{0,63}$", () => {
    assertAKeyWithAHyphenIsRefused();
  });

  it("refuses an extra field, and every immutable field on PATCH", () => {
    assertAnExtraFieldIsRefused();
  });

  it("refuses a non-finite value", () => {
    assertANonFiniteValueIsRefused();
  });

  it("the list query requires organizationId and bounds the key filter", () => {
    assertTheListQueryRequiresAnOrganization();
  });
});
