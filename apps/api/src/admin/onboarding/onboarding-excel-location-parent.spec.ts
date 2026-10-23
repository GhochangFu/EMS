/**
 * `F4.243` (ADR 0098 Amendment 2, B8) — the workbook's `LOCATION` sheet takes
 * the parent by code in a last column, `parent_code`. An empty cell and a
 * workbook without the column are both `null` (a root), so an old workbook
 * still uploads; a cell past the code width is refused without echo. Whether
 * the code names an active location is validate's field error, not the
 * parser's (owner ruling Q2), so nothing here reads the database.
 *
 * The fixture builders are `onboarding-excel.service.spec.ts`'s, so the rows
 * are the workbook the service generates.
 */
import { ONBOARDING_DRAFT_STRING_MAX } from "@bms/shared";

import { OnboardingExcelService } from "./onboarding-excel.service";
import { buildWorkbookBuffer, refusalMessage, templateRows } from "./onboarding-excel.service.spec";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const LOCATION_TYPE_CODES = ["smoc_campus", "rsmoc", "csmoc", "pump_station"] as const;

/** Column 7 of the `LOCATION` header, the last one. */
const PARENT_COLUMN = 7;

function rowsWithParentCell(cell: string): (string | number)[][] {
  const rows = templateRows();
  rows[2] = [...rows[2]];
  rows[2][PARENT_COLUMN] = cell;
  return rows;
}

function parentOf(rows: (string | number)[][]): unknown {
  return new OnboardingExcelService().parseUpload(buildWorkbookBuffer(rows), LOCATION_TYPE_CODES).location.parentCode;
}

/** X1 — a code in the cell is the draft's `parentCode`. */
export function assertAParentCodeCellIsRead(): void {
  const got = parentOf(rowsWithParentCell("CAMPUS-1"));
  assert(got === "CAMPUS-1", `the cell is the parent code, got ${JSON.stringify(got)}`);
}

/** X2 — the generated template names `parent_code` as the last `LOCATION` header. */
export function assertTheTemplateHeaderEndsWithParentCode(): void {
  // `sheet_to_json` pads every row to the widest one (`RTUS`), so the blanks are dropped first.
  const header = templateRows()[1].filter((cell) => cell !== "");
  assert(header[PARENT_COLUMN] === "parent_code" && header.length === PARENT_COLUMN + 1, `header: ${JSON.stringify(header)}`);
}

/** X3 — an empty cell is `null`, a root by choice. Mutation 7 (`parentCode || undefined`) reddens it. */
export function assertAnEmptyParentCellIsNull(): void {
  const got = parentOf(rowsWithParentCell(""));
  assert(got === null, `an empty cell is null, got ${JSON.stringify(got)}`);
}

/** X4 — a workbook built before the column (seven `LOCATION` columns) is `null` too. */
export function assertAWorkbookWithoutTheColumnIsNull(): void {
  const rows = templateRows();
  rows[1] = rows[1].slice(0, PARENT_COLUMN);
  rows[2] = rows[2].slice(0, PARENT_COLUMN);
  const got = parentOf(rows);
  assert(got === null, `a missing column is null, got ${JSON.stringify(got)}`);
}

/** X5 — a cell past the code width refuses the upload, and the cell is not echoed. */
export function assertAnOverlongParentCellIsRefusedWithoutEcho(): void {
  const cell = "P".repeat(ONBOARDING_DRAFT_STRING_MAX["location.parentCode"] + 1);
  const message = refusalMessage(buildWorkbookBuffer(rowsWithParentCell(cell)), "an over-long parent_code cell");
  assert(message.includes("parent_code") && !message.includes(cell), `the refusal names the column only, got "${message}"`);
}

/** X6 — B2 (review #7): the cell is folded to upper case, as the `code` cell is. */
export function assertAParentCellIsFoldedToUpperCase(): void {
  const got = parentOf(rowsWithParentCell("campus-1"));
  assert(got === "CAMPUS-1", `the cell is folded to upper case, got ${JSON.stringify(got)}`);
}

/**
 * X7 — the bound reads the folded value: 64 `ß` are legal as typed and 128
 * characters once upper-cased, so the upload is refused, without echo.
 */
export function assertTheParentBoundReadsTheFoldedValue(): void {
  const cell = "ß".repeat(ONBOARDING_DRAFT_STRING_MAX["location.parentCode"]);
  assert(cell.toUpperCase().length > cell.length, "the fixture must grow when folded — repair the fixture");
  const message = refusalMessage(buildWorkbookBuffer(rowsWithParentCell(cell)), "a parent_code cell over the bound once folded");
  assert(message.includes("parent_code") && !message.includes(cell), `the refusal names the column only, got "${message}"`);
}
