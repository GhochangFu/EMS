import { describe, it } from "vitest";

import {
  aBodyThatIsNotAnErrorDtoFallsBack,
  aCommitSummaryNamesAppliedAndSkipped,
  aFileLevelRefusalReadsAsLabelAndMessage,
  aPreviewWithNothingToWriteSaysSo,
  cellValuesRenderAsTheSheetSpellsThem,
  errorsGroupByExcelRowFileLevelFirst,
  everyErrorCodeHasALabel,
} from "./mapping-sheet-preview.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.7 — the mapping sheet's preview vocabulary (ADR 0056 decisions 6 and 7)", () => {
  it("labels every error code the shared vocabulary declares", () => {
    everyErrorCodeHasALabel();
  });

  it("turns a file-level 400 into the label beside the server's message", () => {
    aFileLevelRefusalReadsAsLabelAndMessage();
  });

  it("falls back to a sentence for a body that is not an error DTO", () => {
    aBodyThatIsNotAnErrorDtoFallsBack();
  });

  it("says a sheet has nothing to write, and counts the suggestions nobody took", () => {
    aPreviewWithNothingToWriteSaysSo();
  });

  it("names what a commit applied and what it skipped", () => {
    aCommitSummaryNamesAppliedAndSkipped();
  });

  it("groups errors by Excel row, file-level problems first", () => {
    errorsGroupByExcelRowFileLevelFirst();
  });

  it("renders a cell value the way the sheet spells it", () => {
    cellValuesRenderAsTheSheetSpellsThem();
  });
});
