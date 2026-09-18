import { describe, it } from "vitest";

import { runParserTests, runParserV2Tests, runParserV3Tests, runV2ErrorWordingTests } from "./parser.spec";

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
