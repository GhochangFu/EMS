import { describe, it } from "vitest";

import { aNonObjectRowIsRefused, aTwentySixthRowIsRefusedBeforeAnyRead, twentyFiveRowsAreRead } from "./copilot-rule-targets.spec";

/** `F4.289` — Vitest entry point for the `ruleBatch` target's shape checks. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.289 — the ruleBatch target refuses a malformed batch before any read", () => {
  it("a twenty-sixth row is refused before any read", () => aTwentySixthRowIsRefusedBeforeAnyRead());
  it("twenty-five rows are read", () => twentyFiveRowsAreRead());
  it("a row that is not an object with a string assetId is refused", () => aNonObjectRowIsRefused());
});
