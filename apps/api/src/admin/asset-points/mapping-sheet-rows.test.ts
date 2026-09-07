import { describe, it } from "vitest";

import {
  assertActiveSpellings,
  assertBlankRowsKeepTheExcelNumbering,
  assertCellErrorsAreDeferredInOrder,
  assertADeclaredZipBombIsRefusedBeforeRead,
  assertASheetCutAtTheReadingBoundIsRefused,
  assertCellsAreReadAsText,
  assertEchoedCellTextIsBounded,
  assertOnlyDecimalLiteralsAreNumbers,
  assertRowNumbersAreAbsoluteWhenTheRangeStartsBelowRowOne,
  assertHeaderIsStrictAndNamesTheOffender,
  assertRequiredCellsAndDuplicateRows,
  assertRowCap,
  assertSheetSelection,
  assertTheHeaderScanIsBoundedByTheTwelve,
  assertTheRowCapTripsWhenTheRangeStartsBelowRowOne,
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

  it("reports absolute Excel row numbers when the used range starts below row 1", () => {
    assertRowNumbersAreAbsoluteWhenTheRangeStartsBelowRowOne();
  });

  it(
    "refuses a sheet over the cap whose used range starts below row 1, and reads one at the cap whole",
    () => {
      assertTheRowCapTripsWhenTheRangeStartsBelowRowOne();
    },
    // Two xlsx fixtures of ~20,000 rows are written and read here; the default
    // 5 s breaches under a full-suite run contending for CPU, as
    // `telemetry-import-rows.test.ts` already records for its own cap fixtures.
    60_000,
  );

  it(
    "refuses a sheet whose reading was cut at the bound, and says that is what fired",
    () => {
      assertASheetCutAtTheReadingBoundIsRefused();
    },
    // One 25,000-row xlsx fixture, written deflated and read back; ~3.5 s alone
    // on the reference machine, and it shares the suite's CPU with every other
    // parallel file.
    60_000,
  );

  it("echoes a 32,767-character cell bounded, with the omitted length stated (security H1)", () => {
    assertEchoedCellTextIsBounded();
  });

  it("accepts only plain decimal literals as numbers — 0x10 is number_invalid, not 16", () => {
    assertOnlyDecimalLiteralsAreNumbers();
  });

  it("refuses a zip that declares a 500 MiB inflation before XLSX.read runs (security H2)", () => {
    assertADeclaredZipBombIsRefusedBeforeRead();
  });

  it("scans the header row over the twelve columns it has, not the width the file declares (F4.101)", () => {
    assertTheHeaderScanIsBoundedByTheTwelve();
  });
});
