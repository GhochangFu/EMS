import { describe, it } from "vitest";

import {
  assertV1ACatalogContradictionIsAnErrorAndNotReady,
  assertV2AnAgreeingDeclarationIsReady,
  assertV3ADomainContradictionNamesTheDomainPath,
  assertV1AnUndeclaredMappingKeyIsAnError,
  assertV1AnUndeclaredMappingKeyIsNotReady,
  assertV1ControlDeclaringTheKeyMakesItReady,
  assertV2ADuplicatePointKeyIsAnError,
  assertV3ADuplicateSourceDataKeyIsAnError,
  assertV4ATemplatedAssetKeepsItsPathAndSentence,
  assertV5AnOutOfRangeRowReportsOnlyTheIndex,
  assertV5ControlTheSameRowInRangeReportsTheKeyAndSource,
  assertV6AnActiveCatalogKeyPassesUndeclared,
  assertV6ControlTheSameKeyOutsideTheCatalogIsAnError,
} from "./onboarding-validate.mappings.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("onboarding validate: draft mappings (F3.23, ADR 0092 decision 2, F4.119)", () => {
  it("V1 an undeclared mapping key is an error at assetPoints.0.pointKey", () => assertV1AnUndeclaredMappingKeyIsAnError());
  it("V1 an undeclared mapping key is not ready to commit", () => assertV1AnUndeclaredMappingKeyIsNotReady());
  it("V1 control: declaring the key makes the draft ready", () => assertV1ControlDeclaringTheKeyMakesItReady());
  it("V2 a duplicate point key on one asset is an error", () => assertV2ADuplicatePointKeyIsAnError());
  it("V3 a duplicate source data key on one asset is an error", () => assertV3ADuplicateSourceDataKeyIsAnError());
  it("V4 a templated asset keeps its path and sentence", () => assertV4ATemplatedAssetKeepsItsPathAndSentence());
  it("V5 an out-of-range row reports only the index", () => assertV5AnOutOfRangeRowReportsOnlyTheIndex());
  it("V5 control: the same row in range reports its key and source", () =>
    assertV5ControlTheSameRowInRangeReportsTheKeyAndSource());
  it("V6 an active catalog key passes undeclared", () => assertV6AnActiveCatalogKeyPassesUndeclared());
  it("V6 control: the same key outside the catalog is an error", () => assertV6ControlTheSameKeyOutsideTheCatalogIsAnError());
});

describe("onboarding validate: a point key the catalog contradicts (F4.225)", () => {
  it("V1 a contradicted unit is an error at its field and the draft is not ready", () => assertV1ACatalogContradictionIsAnErrorAndNotReady());
  it("V2 control: the catalog's unit is ready", () => assertV2AnAgreeingDeclarationIsReady());
  it("V3 a contradicted domain names the domain path", () => assertV3ADomainContradictionNamesTheDomainPath());
});
