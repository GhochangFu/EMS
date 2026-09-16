import { describe, it } from "vitest";

import {
  assertContentTypesAreExactlyTheThree,
  assertControlCharacterRow,
  CONTROL_CHARACTER_ROWS,
  assertDtoRefusesObjectKey,
  assertMaxBytesIsTenMiB,
  assertPerAssetCapIsTwenty,
  assertStorageSectionIsOptionalOnLiveness,
  assertStringAtTheBoundParses,
  assertStringBoundConstantIs,
  assertStringOneOverTheBoundIsRefused,
  STRING_BOUNDS,
} from "./asset-images.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.3 — asset-image constants and contracts (ADR 0066)", () => {
  it("closes the content-type vocabulary to exactly the three types, in order", () => {
    assertContentTypesAreExactlyTheThree();
  });

  it("caps an asset image at 10 MiB", () => {
    assertMaxBytesIsTenMiB();
  });

  it("parses a valid row and refuses one carrying objectKey", () => {
    assertDtoRefusesObjectKey();
  });

  it.each(STRING_BOUNDS)("exports $field's bound as $expected", (bound) => {
    assertStringBoundConstantIs(bound);
  });

  it.each(STRING_BOUNDS)("parses $field at exactly $expected chars", (bound) => {
    assertStringAtTheBoundParses(bound);
  });

  it.each(STRING_BOUNDS)("refuses $field one char over $expected", (bound) => {
    assertStringOneOverTheBoundIsRefused(bound);
  });

  it.each(CONTROL_CHARACTER_ROWS)("$label", (row) => {
    assertControlCharacterRow(row);
  });

  it("makes storage optional on the liveness body, and still validates it when present", () => {
    assertStorageSectionIsOptionalOnLiveness();
  });

  it("caps an asset at 20 images (F3.4, R-3)", () => {
    assertPerAssetCapIsTwenty();
  });
});
