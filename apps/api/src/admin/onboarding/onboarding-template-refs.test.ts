import { describe, it } from "vitest";

import {
  assertANamedPublishedVersionResolves,
  assertANamedUnpublishedVersionIsAProblem,
  assertAStockEntryOverlaysItsPatterns,
  assertAnAuthoredEntryTakesTheCommitDefaults,
  assertAnUnknownCodeIsAProblem,
  assertAnUnknownStockCodeYieldsNoRef,
  assertHeldVersionsCountEveryStatus,
  assertPatternGrammarRefusesAStrayBrace,
  assertTemplateVariablesSkipTheReservedOneAndDerivedPoints,
  assertTheDraftEntryResolvesFirst,
  assertTheHighestPublishedVersionResolves,
} from "./onboarding-template-refs.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("onboarding template refs (F3.22, ADR 0091 decisions 2 and 6)", () => {
  it("an authored entry takes the commit's point defaults", () => {
    assertAnAuthoredEntryTakesTheCommitDefaults();
  });

  it("a stock entry overlays its patterns on the measured points only", () => {
    assertAStockEntryOverlaysItsPatterns();
  });

  it("an unknown stock code yields no ref", () => {
    assertAnUnknownStockCodeYieldsNoRef();
  });

  it("the draft entry resolves before an organization version", () => {
    assertTheDraftEntryResolvesFirst();
  });

  it("with no version, the highest published version resolves", () => {
    assertTheHighestPublishedVersionResolves();
  });

  it("a named published version resolves", () => {
    assertANamedPublishedVersionResolves();
  });

  it("a named unpublished version is a problem", () => {
    assertANamedUnpublishedVersionIsAProblem();
  });

  it("a code with no draft entry and no published version is a problem", () => {
    assertAnUnknownCodeIsAProblem();
  });

  it("the variables skip asset_code and derived points", () => {
    assertTemplateVariablesSkipTheReservedOneAndDerivedPoints();
  });

  it("a brace outside a token is a grammar problem", () => {
    assertPatternGrammarRefusesAStrayBrace();
  });

  it("the held versions count every status", () => {
    assertHeldVersionsCountEveryStatus();
  });
});
