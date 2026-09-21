import { describe, it } from "vitest";

import {
  assertDefinitionCarriesEveryTableCell,
  assertFontsAreTheStandardFourWithNoFile,
  assertMoneyCarriesTheCodeAndNoSymbol,
  assertNonWinAnsiNameDoesNotThrow,
  assertNullCostRendersTheDash,
  assertRenderProducesAPdf,
} from "./energy-pdf.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("energy report PDF (ADR 0071 decision 2)", () => {
  it("carries every energyTable cell into the PDF definition", () => {
    assertDefinitionCarriesEveryTableCell();
  });

  it("carries the ISO currency code beside the amount and never a symbol", () => {
    assertMoneyCarriesTheCodeAndNoSymbol();
  });

  it("renders a null indicative cost as the table's own em dash", () => {
    assertNullCostRendersTheDash();
  });

  it("renders real PDF bytes with the header and the %%EOF tail", async () => {
    await assertRenderProducesAPdf();
  });

  it("does not throw for a non-WinAnsi consumer name", async () => {
    await assertNonWinAnsiNameDoesNotThrow();
  });

  it("names the standard-14 Helvetica by string, with no font file", () => {
    assertFontsAreTheStandardFourWithNoFile();
  });
});
