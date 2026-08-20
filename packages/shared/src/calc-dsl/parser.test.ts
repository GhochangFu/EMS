import { describe, it } from "vitest";

import { runParserTests } from "./parser.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("bms-calc-v1 parser and validator", () => {
  it("parses the grammar, enforces bounds, and never echoes input in errors", () => {
    runParserTests();
  });
});
