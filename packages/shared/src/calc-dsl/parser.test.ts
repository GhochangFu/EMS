import { describe, it } from "vitest";

import {
  runParserTests,
  runParserV2Tests,
  runParserV3Tests,
  runV2ErrorWordingTests,
  runWindowDeltaAndHoursTests,
  runWindowErrorWordingTests,
  runWindowLiteralBoundsTests,
  runWindowMinMaxFormTests,
  runWindowNotAllowedTests,
  runWindowOverAggregateTests,
  runWindowPurityTests,
  runWindowReadsListTests,
  runWindowSumAvgFormTests,
  runWindowV2GuardTests,
  runWindowValidateTests,
} from "./parser.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("bms-calc-v1 parser and validator", () => {
  it("parses the grammar, enforces bounds, and never echoes input in errors", () => {
    runParserTests();
  });
});

describe("bms-calc-v2 parser and validator", () => {
  it("parses aggregates and qualified references, bounds cross refs, and checks local refs only", () => {
    runParserV2Tests();
  });
});

describe("F2.22: author-facing wording for the ten bms-calc-v2 error codes", () => {
  it("rewords every v2 code, echoes nothing, and keeps the position suffix", () => {
    runV2ErrorWordingTests();
  });
});

describe("bms-calc-v3 parser", () => {
  it("parses $key parameter references into a third list, bounds them, and keeps every v2 AST identical", () => {
    runParserV3Tests();
  });
});

describe("bms-calc-v3 parser — windows (E4.1b)", () => {
  it("v2 guard: a windowed form stays a v2 refusal with its v2 code, and a v2 aggregate has the same AST under v3", () => {
    runWindowV2GuardTests();
  });
  it("sum/avg are the window form on a comma after the point reference; the point joins refs or crossRefs", () => {
    runWindowSumAvgFormTests();
  });
  it("min/max are the window form on a bare point reference then a window, the n-ary scalar otherwise", () => {
    runWindowMinMaxFormTests();
  });
  it("delta and hours are v3-only calls, never in CALC_FUNCTION_ARITY, with their own refusals", () => {
    runWindowDeltaAndHoursTests();
  });
  it("a window over a scope aggregate is window_over_aggregate at the comma", () => {
    runWindowOverAggregateTests();
  });
  it("a window token anywhere else is window_not_allowed", () => {
    runWindowNotAllowedTests();
  });
  it("the literal's zero and its 366d cap are the parser's refusals, at the literal", () => {
    runWindowLiteralBoundsTests();
  });
  it("windowReads is deduped by windowKey in first-appearance order and bounded by MAX_FORMULA_WINDOWS", () => {
    runWindowReadsListTests();
  });
  it("every window error message is a sentence free of source text", () => {
    runWindowErrorWordingTests();
  });
  it("parseFormula is pure over a windowed formula", () => {
    runWindowPurityTests();
  });

  it("checks the point inside a window against the known point keys", () => {
    runWindowValidateTests();
  });
});
