import { describe, it } from "vitest";

import { runTokenizerTests } from "./tokenizer.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("bms-calc-v1 tokenizer", () => {
  it("lexes operators, numbers, point refs, and rejects malformed input", () => {
    runTokenizerTests();
  });
});
