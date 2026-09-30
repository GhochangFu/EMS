import { describe, it } from "vitest";

import * as spec from "./mimic-org-symbols.spec";

/** `F3.32f` slice 3 — Vitest entry point for the stored organization symbol re-check. Assertions
 * live in the sibling `.spec` (ADR 0014); one `it()` per claim. */
describe("F3.32f — orgSymbolsOf", () => {
  it("maps a valid row to the DTO", () => spec.mapsAValidRow());
  it("omits a row the contract refuses and keeps the valid one", () => spec.omitsARowTheContractRefuses());
  it("logs the omitted row's id and not its content", () => spec.logsTheIdAndNotTheContent());
  it("maps a string timestamp to ISO", () => spec.acceptsAStringTimestamp());
});
