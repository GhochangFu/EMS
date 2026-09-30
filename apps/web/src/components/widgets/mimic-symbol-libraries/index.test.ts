import { beforeAll, describe, it } from "vitest";

import {
  LIBRARY_CODES_UNDER_GRAMMAR,
  everyShapeParsesUnderTheContractGrammar,
  librarySymbolShapesReportsStrokeForQet,
} from "./index.spec";
import { LAZY_MIMIC_LIBRARY_CODES, ensureLibraryShapes } from ".";

// `F3.32h`: `qet`, `wmpid` and `drawio` load on first use; these claims read them synchronously.
beforeAll(() => ensureLibraryShapes(LAZY_MIMIC_LIBRARY_CODES));

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.32f every vendored shape parses under the contract grammar", () => {
  it.each(LIBRARY_CODES_UNDER_GRAMMAR)("everyShapeOf %s ParsesUnderTheContractGrammar", (code) => {
    everyShapeParsesUnderTheContractGrammar(code);
  });
  it("librarySymbolShapesReportsStrokeForQet", () => {
    librarySymbolShapesReportsStrokeForQet();
  });
});
