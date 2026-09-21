import { describe, it } from "vitest";

import {
  assertDefinitionCarriesEveryTableCell,
  assertFontsAreTheStandardFourWithNoFile,
  assertLocalPolicyAllowsExactlyTheStandardFour,
  assertMoneyCarriesTheCodeAndNoSymbol,
  assertNonWinAnsiNameDoesNotThrow,
  assertEmptyScopeRendersAPdf,
  assertNullCostRendersTheDash,
  assertRenderEmitsNoWarning,
  assertRenderProducesAPdf,
  assertRenderRefusesALocalFilePath,
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

  it("renders an empty scope — no consumers, null cost — to a closed PDF", async () => {
    await assertEmptyScopeRendersAPdf();
  });

  it("names the standard-14 Helvetica by string, with no font file", () => {
    assertFontsAreTheStandardFourWithNoFile();
  });

  it("the local access policy allows exactly the four Standard-14 names (Amendment 1 item 5)", () => {
    assertLocalPolicyAllowsExactlyTheStandardFour();
  });

  it("emits no console.warn on a render — both access policies are set", async () => {
    await assertRenderEmitsNoWarning();
  });

  it("refuses a definition naming a local file path through the policy, not ENOENT", async () => {
    await assertRenderRefusesALocalFilePath();
  });
});
