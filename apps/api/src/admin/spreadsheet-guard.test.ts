import { describe, it } from "vitest";

import {
  assertADeclaredBombIsRefusedFromTheDirectoryAlone,
  assertQuoteCellBoundsEchoedText,
  assertRealWorkbooksAndCsvPass,
  assertZip64AndCorruptDirectoriesAreRefused,
} from "./spreadsheet-guard.spec";

describe("spreadsheet-guard — bounded echoes and declared zip inflation (F2.7 PR 2 security review H1, H2)", () => {
  it("bounds the cell text a message echoes and states the omitted length", () => {
    assertQuoteCellBoundsEchoedText();
  });

  it("passes a real workbook and never refuses a CSV", () => {
    assertRealWorkbooksAndCsvPass();
  });

  it("refuses a zip whose directory declares more than the inflation budget, without inflating it", () => {
    assertADeclaredBombIsRefusedFromTheDirectoryAlone();
  });

  it("refuses zip64 sizes and an unreadable directory", () => {
    assertZip64AndCorruptDirectoriesAreRefused();
  });
});
