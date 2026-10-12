import { describe, it } from "vitest";

import {
  aBodylessEntryTakesOnlyTheEmptyObject,
  aStepSchemaIsPartialAndStrict,
  aStoredPathSurvivesTheBrowserUnchanged,
  everyBodyFieldIsInExactlyOneStep,
  everyBodyIsTheSharedExportByIdentity,
  everyEntryHasAFixtureAndOnlyThose,
  everyFixtureBodyAndPathParses,
  everySummaryNamesItsTarget,
  idsAndToolNamesAreUniqueAndProviderSafe,
  theOnlyDeleteEntriesAreTheTwoRemovals,
  aDeleteOutsideTheAllowanceIsRefused,
  noClientOnlyFieldReachesTheModelBody,
  aModelBodyThatKeepsAClientOnlyFieldIsRefused,
  modelBodyOfOmitsOrRefuses,
  noRouteIsBothAnEntryAndExcluded,
  objectShapeUnwrapsEffectsAndUnions,
  pathParamsAndTheirSchemasAgree,
  refsAndFormulasNameBodyFields,
  theWidgetSummaryCountsRemovedWidgets,
  everyBodyObjectIsStrict,
  aDotSegmentIsNotAPointKey,
  aFormulaPathTheBodyLacksResolvesToNothing,
  aFormulaPathNamesOneSitePerItem,
  aRefsPathCollectsEveryName,
  aBodyWithoutTheFormulaPathHasNoSite,
  aBodyWithoutTheRefsPathHasNoRefs,
  aTopLevelFormulaIsOneSite,
  aFormulaWithoutARefsPathHasNoRefs,
  aDialectOutsideTheFormulasItemIsAnError,
} from "./catalog.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 PR 8 — the copilot action catalog (ADR 0099 decisions 2, 3, 6)", () => {
  it("has one fixture per entry", () => everyEntryHasAFixtureAndOnlyThose());
  it("uses the controller's shared body export by identity", () => everyBodyIsTheSharedExportByIdentity());
  it("takes only {} for a bodyless entry", () => aBodylessEntryTakesOnlyTheEmptyObject());
  it("parses every fixture body and path parameter", () => everyFixtureBodyAndPathParses());
  it("names the target in every summary", () => everySummaryNamesItsTarget());
  it("has unique ids and provider-safe tool names", () => idsAndToolNamesAreUniqueAndProviderSafe());
  it("allows a DELETE only for the two removals", () => theOnlyDeleteEntriesAreTheTwoRemovals());
  it("declares one schema per path parameter", () => pathParamsAndTheirSchemasAgree());
  it("puts every body field in exactly one step", () => everyBodyFieldIsInExactlyOneStep());
  it("names body fields in refs and formulas", () => refsAndFormulasNameBodyFields());
  it("never lists a route as both an entry and excluded", () => noRouteIsBothAnEntryAndExcluded());
  it("unwraps refinements and unions to object shapes", () => objectShapeUnwrapsEffectsAndUnions());
  it("checks a step partially and strictly", () => aStepSchemaIsPartialAndStrict());
  it("stores a path the browser sends unchanged", () => aStoredPathSurvivesTheBrowserUnchanged());
  it("counts the widgets a widget save removes", () => theWidgetSummaryCountsRemovedWidgets());
  it("holds strict body objects only", () => everyBodyObjectIsStrict());
  it("refuses a dot segment as a point key", () => aDotSegmentIsNotAPointKey());
});

describe("F3.86 PR 2 — the DELETE allowance and the model's body (ADR 0099 decision 3)", () => {
  it("refuses a DELETE outside the allowance (positive control)", () => aDeleteOutsideTheAllowanceIsRefused());
  it("keeps every clientOnly field out of the model's body", () => noClientOnlyFieldReachesTheModelBody());
  it("refuses a modelBody that keeps a clientOnly field", () => aModelBodyThatKeepsAClientOnlyFieldIsRefused());
  it("omits clientOnly from a plain body and refuses a refined one without a modelBody", () => modelBodyOfOmitsOrRefuses());
});

describe("F3.85 PR 11a — formula paths into array items (plan §11.3 Unit 2)", () => {
  it("resolves a misspelled formula path to nothing", () => aFormulaPathTheBodyLacksResolvesToNothing());
  it("names one site per array item", () => aFormulaPathNamesOneSitePerItem());
  it("collects every name at a refs path", () => aRefsPathCollectsEveryName());
  it("has no site in a body without the formula path", () => aBodyWithoutTheFormulaPathHasNoSite());
  it("has no refs in a body without the refs path", () => aBodyWithoutTheRefsPathHasNoRefs());
  it("treats a top-level formula as one site", () => aTopLevelFormulaIsOneSite());
  it("has no refs for a formula without a refs path", () => aFormulaWithoutARefsPathHasNoRefs());
  it("refuses a dialect outside the formula's item", () => aDialectOutsideTheFormulasItemIsAnError());
});
