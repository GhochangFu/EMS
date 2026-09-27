import { describe, it } from "vitest";

import {
  assertALongNameIsCutToTheBound,
  assertAnAstralCodeOnTheBoundaryFitsUnchanged,
  assertAnOverflowCodeFillsTheBoundExactly,
  assertASeededCodeIsUnchanged,
  assertASeededNameIsUnchanged,
  assertEverySuffixStaysInsideTheBound,
  assertTheBoundaryCodeFitsUnchanged,
  assertTheBoundaryNameFitsUnchanged,
  assertTheCodeCutNeverSplitsASurrogatePair,
  assertTheCodeIsDeterministic,
  assertTheHashIsOfTheFullCode,
  assertTheNameCutNeverSplitsASurrogatePair,
  assertTheOverflowCodeShape,
  assertTheTailKeepsTheUppercasedDomain,
  assertTwoLongCodesWithACommonPrefixDiffer,
} from "./hierarchy-seed.spec";

describe("F4.170 — simRtuCode bounds the ESKOM simulator RTU code to 64", () => {
  it("leaves a seeded location's code unchanged", () => {
    assertASeededCodeIsUnchanged();
  });

  it("leaves a code sitting exactly on the 64-character boundary unchanged", () => {
    assertTheBoundaryCodeFitsUnchanged();
  });

  it("fills the bound exactly for a code one character past the boundary", () => {
    assertAnOverflowCodeFillsTheBoundExactly();
  });

  it("cuts the location part and inserts an 8-hex uppercase hash on overflow", () => {
    assertTheOverflowCodeShape();
  });

  it("keeps every simulator suffix inside the bound", () => {
    assertEverySuffixStaysInsideTheBound();
  });

  it("gives two long codes with a common prefix two different results", () => {
    assertTwoLongCodesWithACommonPrefixDiffer();
  });

  it("hashes the full raw location code", () => {
    assertTheHashIsOfTheFullCode();
  });

  it("is deterministic", () => {
    assertTheCodeIsDeterministic();
  });

  it("counts code points in the fit check, so an astral code on the boundary is unchanged", () => {
    assertAnAstralCodeOnTheBoundaryFitsUnchanged();
  });

  it("never splits a surrogate pair in the code cut", () => {
    assertTheCodeCutNeverSplitsASurrogatePair();
  });
});

describe("F4.170 — simRtuDisplayName bounds the ESKOM simulator RTU display name to 255", () => {
  it("leaves a seeded location's display name unchanged", () => {
    assertASeededNameIsUnchanged();
  });

  it("leaves a name sitting exactly on the 255-character boundary unchanged", () => {
    assertTheBoundaryNameFitsUnchanged();
  });

  it("cuts a long location name, never the tail", () => {
    assertALongNameIsCutToTheBound();
  });

  it("never splits a surrogate pair in the name cut", () => {
    assertTheNameCutNeverSplitsASurrogatePair();
  });

  it("keeps the uppercased domain in the tail", () => {
    assertTheTailKeepsTheUppercasedDomain();
  });
});
