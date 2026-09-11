// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aV1FormulaRendersLocalRowsOnly,
  aV2FormulaRendersARowPerReferenceAndComputes,
  anEmptyAggregateRowRefusesAtItsOffset,
  disabledDisablesEverySampleInput,
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
});
