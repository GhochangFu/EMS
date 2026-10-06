import { describe, it } from "vitest";

import {
  assertM1AnIndexPastTheAssetsIsAProblem,
  assertM1ControlAnIndexInRangePasses,
  assertM2ATemplatedAssetIsAProblem,
  assertM2ControlAPlainAssetPasses,
  assertM3AnUnresolvedKeyIsAProblem,
  assertM3ControlADeclaredKeyPasses,
  assertM4AnInactiveCatalogKeyIsAProblemEvenWhenDeclared,
  assertM4ControlAnActiveCatalogKeyPassesUndeclared,
  assertM5ADuplicateKeyAgainstExistingIsAProblem,
  assertM5ControlTheSameRowAloneIsClean,
  assertM6ADuplicateSourceInsideAddedIsAProblem,
  assertM6ControlDistinctSourcesPass,
  assertM7TheSamePairsOnTwoAssetsPass,
  assertM7ControlTheSamePairsOnOneAssetAreProblems,
  assertM8SourceKeysCompareExactly,
  assertM8ControlOneSpellingIsAProblem,
  assertM9TwoDefectsOnOneRowAreBothReportedInFieldOrder,
  assertM9ControlARowWithNoAssetStopsAtTheIndex,
} from "./onboarding-mapping-refs.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("onboarding mapping refs (F3.23, ADR 0092 decision 2)", () => {
  it("M1 an assetIndex past the assets is an asset problem", () => assertM1AnIndexPastTheAssetsIsAProblem());
  it("M1 control: an assetIndex in range passes", () => assertM1ControlAnIndexInRangePasses());
  it("M2 a templated asset is refused with the V4 sentence", () => assertM2ATemplatedAssetIsAProblem());
  it("M2 control: a plain asset passes", () => assertM2ControlAPlainAssetPasses());
  it("M3 an unresolved key carries the unresolvedPointKey sentence", () => assertM3AnUnresolvedKeyIsAProblem());
  it("M3 control: a declared key passes", () => assertM3ControlADeclaredKeyPasses());
  it("M4 an inactive catalog key is refused even when declared", () =>
    assertM4AnInactiveCatalogKeyIsAProblemEvenWhenDeclared());
  it("M4 control: an active catalog key passes undeclared", () => assertM4ControlAnActiveCatalogKeyPassesUndeclared());
  it("M5 a duplicate point key against existing is refused", () => assertM5ADuplicateKeyAgainstExistingIsAProblem());
  it("M5 control: the same row alone is clean", () => assertM5ControlTheSameRowAloneIsClean());
  it("M6 a duplicate source key inside added is reported on the later row", () =>
    assertM6ADuplicateSourceInsideAddedIsAProblem());
  it("M6 control: distinct source keys pass", () => assertM6ControlDistinctSourcesPass());
  it("M7 the same pairs on two assets pass", () => assertM7TheSamePairsOnTwoAssetsPass());
  it("M7 control: the same pairs on one asset are refused", () => assertM7ControlTheSamePairsOnOneAssetAreProblems());
  it("M8 source keys compare exactly", () => assertM8SourceKeysCompareExactly());
  it("M8 control: one spelling is refused", () => assertM8ControlOneSpellingIsAProblem());
  it("M9 two defects on one row are both reported, in field order", () =>
    assertM9TwoDefectsOnOneRowAreBothReportedInFieldOrder());
  it("M9 control: a row with no asset stops at assetIndex", () => assertM9ControlARowWithNoAssetStopsAtTheIndex());
});
