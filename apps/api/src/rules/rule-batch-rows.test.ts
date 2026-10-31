import { describe, it } from "vitest";

import {
  aBlankCodeIsNotADuplicate,
  aDuplicateCodeNamesBothRows,
  anIndexPastTheEndIsIgnored,
  excludedRowsRemoveRowsAndKeepTheOriginalIndex,
} from "./rule-batch-rows.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.289 — the batch row helpers", () => {
  it("excluded rows are removed and every kept row keeps its original index", () => excludedRowsRemoveRowsAndKeepTheOriginalIndex());
  it("an index past the end is ignored", () => anIndexPastTheEndIsIgnored());
  it("a duplicate code names both rows", () => aDuplicateCodeNamesBothRows());
  it("a blank code is not a duplicate", () => aBlankCodeIsNotADuplicate());
});
