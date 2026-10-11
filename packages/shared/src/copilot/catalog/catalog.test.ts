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
  noEntryIsADelete,
  noRouteIsBothAnEntryAndExcluded,
  objectShapeUnwrapsEffectsAndUnions,
  pathParamsAndTheirSchemasAgree,
  refsAndFormulasNameBodyFields,
  theWidgetSummaryCountsRemovedWidgets,
  everyBodyObjectIsStrict,
  aDotSegmentIsNotAPointKey,
} from "./catalog.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 PR 8 — the copilot action catalog (ADR 0099 decisions 2, 3, 6)", () => {
  it("has one fixture per entry", () => everyEntryHasAFixtureAndOnlyThose());
  it("uses the controller's shared body export by identity", () => everyBodyIsTheSharedExportByIdentity());
  it("takes only {} for a bodyless entry", () => aBodylessEntryTakesOnlyTheEmptyObject());
  it("parses every fixture body and path parameter", () => everyFixtureBodyAndPathParses());
  it("names the target in every summary", () => everySummaryNamesItsTarget());
  it("has unique ids and provider-safe tool names", () => idsAndToolNamesAreUniqueAndProviderSafe());
  it("holds no DELETE", () => noEntryIsADelete());
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
