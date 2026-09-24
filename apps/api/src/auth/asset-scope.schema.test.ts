import { describe, it } from "vitest";

import {
  assertANonUuidIsRefused,
  assertAbsentAssetIdsStaysUndefined,
  assertSingleValueBecomesOneElementArray,
  assertTheCapIsEnforced,
} from "./asset-scope.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.28 — assetIdsQueryField (ADR 0074, plan decision 1)", () => {
  it("normalises a single value to a one-element array", () => {
    assertSingleValueBecomesOneElementArray();
  });

  it("leaves an absent assetIds undefined", () => {
    assertAbsentAssetIdsStaysUndefined();
  });

  it("accepts exactly the cap and refuses one more", () => {
    assertTheCapIsEnforced();
  });

  it("refuses a non-uuid value", () => {
    assertANonUuidIsRefused();
  });
});
