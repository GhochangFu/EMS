import { describe, it } from "vitest";

import * as spec from "./mimic-symbol-libraries.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F3.32f — MimicSymbolLibrariesService.labelOf", () => {
  it("does not cut a stem inside a surrogate pair", () => spec.aStemIsNotCutInsideASurrogatePair());
  it("keeps an emoji that fits", () => spec.anEmojiThatFitsIsKept());
  it("takes the stated label, then the stem, then the key's name", () => spec.theStatedLabelThenTheStemThenTheKeyName());
});
