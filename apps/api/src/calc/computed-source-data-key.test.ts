import { describe, it } from "vitest";

import {
  assertFormatIsExactlyComputedColonPointKey,
  assertItNeverThrows,
  assertTheLengthBoundaryIsExact,
} from "./computed-source-data-key.spec";

/** `F2.6` U4 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.6 — the shared computed: source_data_key format", () => {
  it("formats exactly as computed:<pointKey>", () => {
    assertFormatIsExactlyComputedColonPointKey();
  });

  it("accepts the longest key that fits and refuses the first that does not", () => {
    assertTheLengthBoundaryIsExact();
  });

  it("refuses rather than throwing", () => {
    assertItNeverThrows();
  });
});
