import { describe, it } from "vitest";

import {
  assertAnEmptyMergeHasNoProblems,
  assertAnOverrideOfBothBoundsIgnoresTheTemplatePair,
  assertHasAnyPointMetadataReadsNullAsAbsent,
  assertOverrideEngMaxBesideInheritedEngMinIsRefused,
  assertOverrideEngMinBesideInheritedEngMaxIsRefused,
  assertTheWriteShapeRefusesAnInvertedOrEmptyBand,
  assertTheWriteShapeRefusesAZeroMultiplier,
  assertTheWriteShapeRefusesNonFiniteNumbers,
} from "./point-metadata.schema.spec";

/** `F2.7` C1 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.7 — point metadata write shape and the merged-pair check", () => {
  it("refuses an overridden eng_min beside an inherited eng_max, naming the inherited bound", () => {
    assertOverrideEngMinBesideInheritedEngMaxIsRefused();
  });

  it("refuses the mirror — an overridden eng_max beside an inherited eng_min", () => {
    assertOverrideEngMaxBesideInheritedEngMinIsRefused();
  });

  it("reports nothing when neither side sets a bound", () => {
    assertAnEmptyMergeHasNoProblems();
  });

  it("ignores the template's pair when the override restates both bounds", () => {
    assertAnOverrideOfBothBoundsIgnoresTheTemplatePair();
  });

  it("refuses a zero scale multiplier and accepts a negative one", () => {
    assertTheWriteShapeRefusesAZeroMultiplier();
  });

  it("refuses an inverted or empty engineering band", () => {
    assertTheWriteShapeRefusesAnInvertedOrEmptyBand();
  });

  it("refuses NaN, Infinity and an unknown quality policy", () => {
    assertTheWriteShapeRefusesNonFiniteNumbers();
  });

  it("reads an explicit null as 'clears', not as 'carries metadata'", () => {
    assertHasAnyPointMetadataReadsNullAsAbsent();
  });
});
