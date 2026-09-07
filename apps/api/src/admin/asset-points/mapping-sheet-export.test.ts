import { describe, it } from "vitest";

import {
  assertBufferHasNoFormulaCells,
  assertExistingRowsAreWrittenAsStored,
  assertPreFillRowsFromTheTemplate,
  assertRowsAreSorted,
} from "./mapping-sheet-export.spec";

/** `F2.7` G3 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.7 — the MAPPINGS export row set (ADR 0056 decision 6)", () => {
  it("writes the header and every non-computed row of an active asset as stored, TRUE/FALSE for active", () => {
    assertExistingRowsAreWrittenAsStored();
  });

  it("pre-fills a measured template point with no row: {asset_code} substituted, other tokens literal, active blank", () => {
    assertPreFillRowsFromTheTemplate();
  });

  it("sorts by asset code then point key", () => {
    assertRowsAreSorted();
  });

  it("produces a buffer with no formula cell — a formula-looking code is a string (ADR 0026)", () => {
    assertBufferHasNoFormulaCells();
  });
});
