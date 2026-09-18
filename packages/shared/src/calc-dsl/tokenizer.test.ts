import { describe, it } from "vitest";

import { runTokenizerTests, runTokenizerV2Tests, runTokenizerV3Tests } from "./tokenizer.spec";

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

describe("bms-calc-v3 tokenizer", () => {
  it("lexes $key parameter references only under the v3 dialect, and everything v2 lexes identically", () => {
    runTokenizerV3Tests();
  });
});
