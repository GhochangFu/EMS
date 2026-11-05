import { describe, it } from "vitest";

import {
  runDialectsAreSupersetsTests,
  runEveryExampleParsesTests,
  runFunctionsComeFromTheConstantTests,
  runHoursIsTheParsersTests,
  runInsertsAreUsableTests,
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

  it("the functions are the grammar's, one entry per CALC_FUNCTION_ARITY key", () => {
    runFunctionsComeFromTheConstantTests();
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

  it("every insert is non-empty and a function inserts its name and (", () => {
    runInsertsAreUsableTests();
  });

  it("labels are unique within a dialect's list", () => {
    runLabelsAreUniqueTests();
  });
});
