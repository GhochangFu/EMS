import { describe, it } from "vitest";

import {
  assertANamedKeyObjectIsRefused,
  assertANonUuidIsRefused,
  assertASparseIndexObjectIsRefused,
  assertAbsentAssetIdsStaysUndefined,
  assertOnePastTheCapIsRefusedThroughTheParser,
  assertSingleValueBecomesOneElementArray,
  assertTheCapIsEnforced,
  assertTheCapParsesThroughTheParser,
  assertTwentyOneRepeatsParseInOrder,
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

  it("parses 21 repeats through the API's own query parser, in order", () => {
    assertTwentyOneRepeatsParseInOrder();
  });

  it("parses the cap (200 repeats) through the API's own query parser", () => {
    assertTheCapParsesThroughTheParser();
  });

  it("refuses 201 repeats through the API's own query parser", () => {
    assertOnePastTheCapIsRefusedThroughTheParser();
  });

  it("refuses a named-key object (assetIds[a]=…)", () => {
    assertANamedKeyObjectIsRefused();
  });

  it("refuses a sparse-index object (assetIds[30]=…)", () => {
    assertASparseIndexObjectIsRefused();
  });
});
