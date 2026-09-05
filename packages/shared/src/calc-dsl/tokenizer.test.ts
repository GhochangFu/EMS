import { describe, it } from "vitest";

import { runTokenizerTests, runTokenizerV2Tests } from "./tokenizer.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("bms-calc-v1 tokenizer", () => {
  it("lexes operators, numbers, point refs, and rejects malformed input", () => {
    runTokenizerTests();
  });
});

describe("bms-calc-v2 tokenizer", () => {
  it("lexes scopes, strings and qualified references only under the v2 dialect", () => {
    runTokenizerV2Tests();
  });
});
