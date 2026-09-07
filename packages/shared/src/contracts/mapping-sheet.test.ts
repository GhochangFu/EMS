import { describe, it } from "vitest";

import {
  assertChangeDtoBindsTheFieldVocabulary,
  assertCreateAndUpdateDtos,
  assertErrorCodesAre24Distinct,
  assertErrorDtoAcceptsBothLevels,
  assertHeaderIsTheTwelveInOrder,
  assertPreviewAndCommitDtos,
} from "./mapping-sheet.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.7 — the MAPPINGS sheet contract (ADR 0056 decisions 6, 7)", () => {
  it("names the twelve columns in the ADR's order and the one sheet", () => {
    assertHeaderIsTheTwelveInOrder();
  });

  it("lists exactly 24 distinct error codes and derives the schema from them", () => {
    assertErrorCodesAre24Distinct();
  });

  it("carries a file-level and a row-level error in one shape, refusing an unknown code or column", () => {
    assertErrorDtoAcceptsBothLevels();
  });

  it("binds a change to one of the nine editable fields", () => {
    assertChangeDtoBindsTheFieldVocabulary();
  });

  it("accepts a create and an update fixture and refuses a missing or unknown key", () => {
    assertCreateAndUpdateDtos();
  });

  it("requires untouchedSuggestions on the preview and both applied counts on the commit", () => {
    assertPreviewAndCommitDtos();
  });
});
