import { describe, it } from "vitest";

import {
  assertAnEmptyParentCellIsNull,
  assertAnOverlongParentCellIsRefusedWithoutEcho,
  assertAParentCellIsFoldedToUpperCase,
  assertAParentCodeCellIsRead,
  assertAWorkbookWithoutTheColumnIsNull,
  assertTheParentBoundReadsTheFoldedValue,
  assertTheTemplateHeaderEndsWithParentCode,
} from "./onboarding-excel-location-parent.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.243 — the workbook's parent_code column (ADR 0098 Amendment 2, B8)", () => {
  it("X1 reads a parent code cell", () => {
    assertAParentCodeCellIsRead();
  });
  it("X2 ends the template's LOCATION header with parent_code", () => {
    assertTheTemplateHeaderEndsWithParentCode();
  });
  it("X3 reads an empty cell as null", () => {
    assertAnEmptyParentCellIsNull();
  });
  it("X4 reads a workbook without the column as null", () => {
    assertAWorkbookWithoutTheColumnIsNull();
  });
  it("X5 refuses an over-long cell without echo", () => {
    assertAnOverlongParentCellIsRefusedWithoutEcho();
  });
  it("X6 folds the cell to upper case", () => {
    assertAParentCellIsFoldedToUpperCase();
  });
  it("X7 bounds the folded cell", () => {
    assertTheParentBoundReadsTheFoldedValue();
  });
});
