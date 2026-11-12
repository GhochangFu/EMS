import { describe, it } from "vitest";

import {
  runDeltaNamesTheFallingCounterRefusalTests,
  runDialectsAreSupersetsTests,
  runEveryExampleParsesTests,
  runEachArityKeyHasOneFunctionEntryTests,
  runEachNewerDialectAddsEntriesTests,
  runFunctionInsertsOpenTheCallTests,
  runInsertsAreNonEmptyTests,
  runNoEntryCallsOutsideTheGrammarTests,
  runParameterTextDropsTheLeadTests,
  runParameterTextIsCutAtTheDashTests,
  runParameterTextIsTheHelpsTests,
  runHoursIsTheParsersTests,
  runLabelsAreUniqueTests,
  runOperatorsTokenizeTests,
  runV1HasNoNewerGroupsTests,
  runV2OnlyExamplesAreNotV1Tests,
} from "./formula-help.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("formula help entries (F4.314)", () => {
  it("every example parses under the dialect whose list carries it", () => {
    runEveryExampleParsesTests();
  });

  it("has exactly one function entry per CALC_FUNCTION_ARITY key", () => {
    runEachArityKeyHasOneFunctionEntryTests();
  });

  it("calls no name outside the grammar's functions, aggregates, windows and hours", () => {
    runNoEntryCallsOutsideTheGrammarTests();
  });

  it("every operator glyph tokenizes to one token under v1", () => {
    runOperatorsTokenizeTests();
  });

  it("hours() is held to the parser's window form under v3", () => {
    runHoursIsTheParsersTests();
  });

  it("the v1 list has no scope, parameter or window entry", () => {
    runV1HasNoNewerGroupsTests();
  });

  it("an entry v2 adds reads a cross reference under v2 and none under v1", () => {
    runV2OnlyExamplesAreNotV1Tests();
  });

  it("v3 carries every v2 entry and v2 every v1 entry", () => {
    runDialectsAreSupersetsTests();
  });

  it("each newer dialect's list is strictly larger", () => {
    runEachNewerDialectAddsEntriesTests();
  });

  it("every insert is non-empty", () => {
    runInsertsAreNonEmptyTests();
  });

  it("a function entry inserts its name and (", () => {
    runFunctionInsertsOpenTheCallTests();
  });

  it("labels are unique within a dialect's list", () => {
    runLabelsAreUniqueTests();
  });

  it("the $key text ends V3_PARAMETER_HELP", () => {
    runParameterTextIsTheHelpsTests();
  });

  it("the $key text drops the sentence's $key lead", () => {
    runParameterTextDropsTheLeadTests();
  });

  it("the $key text is cut at the dash, not inside $key", () => {
    runParameterTextIsCutAtTheDashTests();
  });

  it("the delta entry names the falling-counter refusal (F4.353, ADR 0070 Amendment 8)", () => {
    runDeltaNamesTheFallingCounterRefusalTests();
  });
});
