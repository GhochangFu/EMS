import { describe, it } from "vitest";

import * as spec from "./mimic-library-codes.spec";

/** `F3.32f` slice 1 — Vitest entry point for the stored library-code read guard. Assertions live
 * in the sibling `.spec` (ADR 0014); one `it()` per claim. */
describe("F3.32f — splitLibraryCodes", () => {
  it("keeps every known code and drops nothing", () => spec.keepsEveryKnownCode());
  it("drops an unknown code and keeps the known one", () => spec.dropsAnUnknownCode());
  it("preserves the order and the duplicates", () => spec.preservesOrderAndDuplicates());
  it("answers two empty arrays for an empty input", () => spec.answersEmptyForEmpty());
  it("reads the known parameter, not the contract", () => spec.readsTheKnownParameter());
});
