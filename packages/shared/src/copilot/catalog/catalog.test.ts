import { describe, it } from "vitest";

import {
  aBodylessEntryTakesOnlyTheEmptyObject,
  noMimicOrRoleRouteIsPending,
  theLibraryAndRoleSummariesNameTheirTarget,
  theLibraryEntriesAreForTheAuthors,
  theRoleCreateIsForTheGlobalAdminOnly,
  theSymbolUploadIsTheMultipartEntry,
  theUploadModelBodyTakesTextOrAnAttachment,
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
  aGrantSummaryNamesItsTarget,
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
  theMemberRemovalIsARedBodylessDelete,
  thePointKeyEntriesAreFleetTargets,
  theOnboardingCommitIsAServerEntry,
  anUploadModelBodyAddsTheSvgAndOnlyThere,
  theReleaseThreeEntryFieldsAreWellFormed,
  noCardOnlyKeyIsABodyField,
  theHashLeavesOutClientOnlyAndCardOnlyKeys,
  theCanvasExemptionIsExact,
  theLayoutEntriesAreCanvasEntriesForTheAuthors,
  theLayoutSummariesCountTheGraph,
  cardOnlyKeysForNamesTheStrippedKeys,
  aMalformedReleaseThreeEntryIsRefused,
  aCardOnlyKeyInTheBodyIsRefused,
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
  it("names the grant target in a grant summary (PR 4)", () => aGrantSummaryNamesItsTarget());
});

describe("F3.86 PR 3c — asset groups and point keys (ADR 0099 decision 3, ruling Q1)", () => {
  it("makes the member removal a red, bodyless DELETE", () => theMemberRemovalIsARedBodylessDelete());
  it("targets the point-key entries at the fleet", () => thePointKeyEntriesAreFleetTargets());
});

describe("F3.86 PR 6 — the onboarding commit (ADR 0099 decision 7)", () => {
  it("makes the onboarding commit a server entry on the session", () => theOnboardingCommitIsAServerEntry());
});

describe("F3.87 PR 2 — release-3 entry fields (ADR 0099 Amendment 3 A1, A3; owner ruling Q1)", () => {
  it("adds svg to an upload modelBody, and only there", () => anUploadModelBodyAddsTheSvgAndOnlyThere());
  it("makes an upload entry a POST with a modelBody, offered to copilot roles only", () => theReleaseThreeEntryFieldsAreWellFormed());
  it("refuses a malformed upload or offeredTo (negative control)", () => aMalformedReleaseThreeEntryIsRefused());
  it("never makes a cardOnly key a body field", () => noCardOnlyKeyIsABodyField());
  it("refuses a cardOnly key in the body, the model body or a fixture (negative control)", () => aCardOnlyKeyInTheBodyIsRefused());
  it("leaves clientOnly and cardOnly keys out of the hash", () => theHashLeavesOutClientOnlyAndCardOnlyKeys());
  it("exempts exactly the canvas entries from the step rule", () => theCanvasExemptionIsExact());
  it("F3.87 PR 5: the layout entries are canvas entries for the authoring roles", () => theLayoutEntriesAreCanvasEntriesForTheAuthors());
  it("F3.87 PR 5: the layout summaries count the graph", () => theLayoutSummariesCountTheGraph());
  it("F3.87 PR 5: cardOnlyKeysFor names the keys the browser strips", () => cardOnlyKeysForNamesTheStrippedKeys());
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

describe("F3.87 PR 6 — the library, symbol and role entries (ADR 0099 Amendment 3 A1, A3; ruling Q4)", () => {
  it("offers the five library and symbol entries to the authoring roles", () => theLibraryEntriesAreForTheAuthors());
  it("makes the symbol upload the one multipart entry, svgText card-only", () => theSymbolUploadIsTheMultipartEntry());
  it("takes the model's SVG as text or as an attachment index only", () => theUploadModelBodyTakesTextOrAnAttachment());
  it("offers assetRole.create to the global admin only", () => theRoleCreateIsForTheGlobalAdminOnly());
  it("leaves no mimic or role route pending", () => noMimicOrRoleRouteIsPending());
  it("names the target in each library and role summary", () => theLibraryAndRoleSummariesNameTheirTarget());
});
