import { describe, it } from "vitest";

import {
  assertAGroupedNumberIsRefusedWithoutEcho,
  assertANegativeNumberIsRefused,
  assertANumericCellIsRead,
  assertAValueBelowTheBoundParses,
  assertAnUploadedFt2BelowOneSquareMetreIsRefusedByTheDraft,
  assertAnUploadedSquareMetreBoundIsAdmitted,
  assertAValueWithATrailingUnitIsRefused,
  assertAWorkbookWithoutTheColumnsIsNull,
  assertAnEmptyAreaCellIsNull,
  assertAnEmptyUnitIsM2,
  assertAnUnknownUnitIsRefusedWithoutEcho,
  assertExponentNotationIsRefused,
  assertTheHeaderEndsWithTheAreaPair,
  assertTheTemplateParsesWithItsExampleArea,
  assertTheUnitIsFolded,
} from "./onboarding-excel-floor-area.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.304 — the workbook's floor_area and floor_area_unit columns (ADR 0108 Amendment 5 item 6)", () => {
  it("E1 parses the generated template's example area", () => {
    assertTheTemplateParsesWithItsExampleArea();
  });
  it("E2 ends the LOCATION header with parent_code, floor_area, floor_area_unit", () => {
    assertTheHeaderEndsWithTheAreaPair();
  });
  it("E3 reads an empty floor_area cell as null", () => {
    assertAnEmptyAreaCellIsNull();
  });
  it("E4 reads a workbook without the two columns as null", () => {
    assertAWorkbookWithoutTheColumnsIsNull();
  });
  it("E5 reads a numeric cell", () => {
    assertANumericCellIsRead();
  });
  it("E6 refuses 1,200 with the fixed sentence and no echo", () => {
    assertAGroupedNumberIsRefusedWithoutEcho();
  });
  it("E7 refuses -5", () => {
    assertANegativeNumberIsRefused();
  });
  it("E8 folds the unit FT2 to ft2", () => {
    assertTheUnitIsFolded();
  });
  it("E9 refuses an unknown unit naming m2, ft2 and the length, never the text", () => {
    assertAnUnknownUnitIsRefusedWithoutEcho();
  });
  it("E10 reads an empty unit with a value as m2", () => {
    assertAnEmptyUnitIsM2();
  });
  it("E11 parses 0.5 (the bound is validate's)", () => {
    assertAValueBelowTheBoundParses();
  });
  it("E12 refuses 1e3", () => {
    assertExponentNotationIsRefused();
  });
  it("E13 refuses 1200 m2 in one cell", () => {
    assertAValueWithATrailingUnitIsRefused();
  });
  it("E14 refuses 10.76 ft2 at the draft's floorArea.value with the m2 message (owner ruling 2026-11-03)", () => {
    assertAnUploadedFt2BelowOneSquareMetreIsRefusedByTheDraft();
  });
  it("E15 admits 10.77 ft2 and 1 m2 from the workbook (owner ruling 2026-11-03)", () => {
    assertAnUploadedSquareMetreBoundIsAdmitted();
  });
});
