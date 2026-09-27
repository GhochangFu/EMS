import { describe, it } from "vitest";

import {
  assertAHyphenAndAnUnderscoreDiffer,
  assertALongNameIsCutToTheBound,
  assertANameOnTheBoundaryIsUnchanged,
  assertAnOverflowFillsTheBoundExactly,
  assertAShortCodeIsUnchanged,
  assertAShortNameIsUnchanged,
  assertEverySuffixStaysInsideTheBound,
  assertOneBelowTheBoundaryFitsUnchanged,
  assertTheBoundaryFitsUnchanged,
  assertTheCutIsDeterministic,
  assertTheHashIsOfTheFullCode,
  assertTheNameCutNeverSplitsASurrogatePair,
  assertTheOverflowShape,
  assertTwoLongCodesWithACommonPrefixDiffer,
} from "./automation-rules-seed.spec";

describe("F4.129 — ladderRuleCode bounds the ESKOM ladder rule code to 64", () => {
  it("leaves a short code unchanged", () => {
    assertAShortCodeIsUnchanged();
  });

  it("leaves a code sitting exactly on the 64-character boundary unchanged", () => {
    assertTheBoundaryFitsUnchanged();
  });

  it("leaves a code one character below the boundary unchanged", () => {
    assertOneBelowTheBoundaryFitsUnchanged();
  });

  it("fills the bound exactly for a code one character past the boundary", () => {
    assertAnOverflowFillsTheBoundExactly();
  });

  it("cuts the asset part and inserts an 8-hex uppercase hash prefix on overflow", () => {
    assertTheOverflowShape();
  });

  it("is deterministic across two calls on the same inputs", () => {
    assertTheCutIsDeterministic();
  });

  it("keeps two long codes with a common prefix distinct", () => {
    assertTwoLongCodesWithACommonPrefixDiffer();
  });

  it("keeps every one of the five ladder suffixes inside the bound, and distinct", () => {
    assertEverySuffixStaysInsideTheBound();
  });

  it("keeps two long codes that differ only by - against _ distinct", () => {
    assertAHyphenAndAnUnderscoreDiffer();
  });

  it("hashes the full asset code, not the cut", () => {
    assertTheHashIsOfTheFullCode();
  });
});

describe("F4.129 — ladderRuleName bounds the ESKOM ladder rule name to 255", () => {
  it("leaves a short name unchanged", () => {
    assertAShortNameIsUnchanged();
  });

  it("leaves a name sitting exactly on the 255-character boundary unchanged", () => {
    assertANameOnTheBoundaryIsUnchanged();
  });

  it("cuts a 255-character asset name so the rule name is 255 and keeps the suffix", () => {
    assertALongNameIsCutToTheBound();
  });

  it("cuts by code point, never inside a surrogate pair", () => {
    assertTheNameCutNeverSplitsASurrogatePair();
  });
});
