import { describe, it } from "vitest";

import { runParserTests, runParserV2Tests } from "./parser.spec";

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
