// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aV1FormulaRendersLocalRowsOnly,
  aV2FormulaRendersARowPerReferenceAndComputes,
  anEmptyAggregateRowRefusesAtItsOffset,
  disabledDisablesEverySampleInput,
  aV3FormulaRendersAParameterRowAndComputes,
  aV3FormulaUnderV2RendersNothing,
  aV3WindowReadRendersItsOwnRowAndComputes,
  eachCrossReferenceFormIsLabelledAsWritten,
  unparsableTextRendersNothing,
} from "./formula-preview.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F2.22 formula preview — one sample value per reference, cross-asset included (ADR 0038 decision 5)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a row per reference under bms-calc-v2, the aggregate as one input, and computes 10 / 2", () => {
    aV2FormulaRendersARowPerReferenceAndComputes();
  });

  it("refuses at the aggregate's offset while its sample row is empty, naming both maps", () => {
    anEmptyAggregateRowRefusesAtItsOffset();
  });

  it("renders local rows only under bms-calc-v1 and computes 3 + 4", () => {
    aV1FormulaRendersLocalRowsOnly();
  });

  it("renders no rows and no result line for unparsable text", () => {
    unparsableTextRendersNothing();
  });

  it("disables every sample input when disabled", () => {
    disabledDisablesEverySampleInput();
  });

  it("labels a scoped aggregate and a qualified reference as the author wrote them", () => {
    eachCrossReferenceFormIsLabelledAsWritten();
  });

  it("renders a $key sample row under bms-calc-v3, labelled as written, and computes 10 × 2.15", () => {
    aV3FormulaRendersAParameterRowAndComputes();
  });

  it("renders nothing for the same text under bms-calc-v2 — the $ does not lex there", () => {
    aV3FormulaUnderV2RendersNothing();
  });

  it("renders a window read as its own row, labelled delta({kwh}, today), and computes 70 / 2 (E4.1b)", () => {
    aV3WindowReadRendersItsOwnRowAndComputes();
  });
});
