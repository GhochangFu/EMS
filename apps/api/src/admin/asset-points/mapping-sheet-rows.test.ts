import { describe, it } from "vitest";

import {
  assertActiveSpellings,
  assertBlankRowsKeepTheExcelNumbering,
  assertCellErrorsAreDeferredInOrder,
  assertCellsAreReadAsText,
  assertHeaderIsStrictAndNamesTheOffender,
  assertRequiredCellsAndDuplicateRows,
  assertRowCap,
  assertSheetSelection,
} from "./mapping-sheet-rows.spec";

/** `F2.7` G2 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.7 — parseMappingSheet, the pure half of the import", () => {
  it("accepts the twelve in order (any case, trimmed) and names the offending header otherwise", () => {
    assertHeaderIsStrictAndNamesTheOffender();
  });

  it("reads a CSV's one sheet, requires MAPPINGS in an xlsx, and refuses an empty, header-only or oversized file", () => {
    assertSheetSelection();
  });

  it("refuses more than MAX_IMPORT_ROWS data rows and accepts exactly the cap", () => {
    assertRowCap();
  });

  it("parses the boolean spellings of active, keeps blank as null, and refuses anything else", () => {
    assertActiveSpellings();
  });

  it("attaches steps 10-12 to the row as one deferred error, in step order", () => {
    assertCellErrorsAreDeferredInOrder();
  });

  it("refuses a blank asset_code or point_key and a duplicate (asset_code, point_key) on the later row", () => {
    assertRequiredCellsAndDuplicateRows();
  });

  it("skips blank rows without renumbering the rest", () => {
    assertBlankRowsKeepTheExcelNumbering();
  });

  it("reads every cell as trimmed text before it parses a number", () => {
    assertCellsAreReadAsText();
  });
});
