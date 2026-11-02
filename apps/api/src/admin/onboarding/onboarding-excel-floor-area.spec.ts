/**
 * `F4.304` (ADR 0108 Amendment 5 item 6, plan C10) — the workbook's `LOCATION`
 * sheet takes a floor area in two trailing columns, `floor_area` and
 * `floor_area_unit`. An empty `floor_area` cell and a workbook without the
 * columns are both `null`, so an older workbook still uploads. A cell that is
 * not a plain decimal literal, or a unit other than `m2`/`ft2`, refuses the
 * upload with a sentence that names the column and never echoes the cell
 * (AGENTS.md §4.3). A value outside the bounds is validate's field error
 * (`location.floorArea.value`), not the parser's, so 0.5 parses here.
 *
 * The fixture builders are `onboarding-excel.service.spec.ts`'s, so the rows
 * are the workbook the service generates.
 */
import { OnboardingExcelService } from "./onboarding-excel.service";
import { buildWorkbookBuffer, refusalMessage, templateRows } from "./onboarding-excel.service.spec";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const LOCATION_TYPE_CODES = ["smoc_campus", "rsmoc", "csmoc", "pump_station"] as const;

/** Columns 8 and 9 of the `LOCATION` header, after `parent_code` at 7. */
const AREA_COLUMN = 8;
const UNIT_COLUMN = 9;

export const NOT_A_NUMBER_SENTENCE =
  "LOCATION row 1 has a floor_area that is not a number; use a plain decimal such as 1200 and upload the workbook again";

function rowsWithAreaCells(area: string | number, unit?: string): (string | number)[][] {
  const rows = templateRows();
  rows[2] = [...rows[2]];
  rows[2][AREA_COLUMN] = area;
  if (unit !== undefined) {
    rows[2][UNIT_COLUMN] = unit;
  }
  return rows;
}

function areaOf(rows: (string | number)[][]): unknown {
  return new OnboardingExcelService().parseUpload(buildWorkbookBuffer(rows), LOCATION_TYPE_CODES).location.floorArea;
}

function same(got: unknown, want: unknown): boolean {
  return JSON.stringify(got) === JSON.stringify(want);
}

/** E1 — the generated template, parsed, carries its example area. */
export function assertTheTemplateParsesWithItsExampleArea(): void {
  const got = areaOf(templateRows());
  assert(same(got, { value: 1200, unit: "m2" }), `the template's area, got ${JSON.stringify(got)}`);
}

/** E2 — the header ends with `parent_code, floor_area, floor_area_unit`. */
export function assertTheHeaderEndsWithTheAreaPair(): void {
  const header = templateRows()[1].filter((cell) => cell !== "");
  const tail = header.slice(-3);
  assert(same(tail, ["parent_code", "floor_area", "floor_area_unit"]), `header tail: ${JSON.stringify(tail)}`);
}

/** E3 — an empty `floor_area` cell is `null`. */
export function assertAnEmptyAreaCellIsNull(): void {
  const got = areaOf(rowsWithAreaCells(""));
  assert(got === null, `an empty cell is null, got ${JSON.stringify(got)}`);
}

/** E4 — a workbook built before the two columns is `null`. */
export function assertAWorkbookWithoutTheColumnsIsNull(): void {
  const rows = templateRows();
  rows[1] = rows[1].slice(0, AREA_COLUMN);
  rows[2] = rows[2].slice(0, AREA_COLUMN);
  const got = areaOf(rows);
  assert(got === null, `missing columns are null, got ${JSON.stringify(got)}`);
}

/** E5 — a numeric cell (the row carries a number, not a string) is read. */
export function assertANumericCellIsRead(): void {
  const rows = rowsWithAreaCells(1200.5);
  assert(typeof rows[2][AREA_COLUMN] === "number", "the fixture must carry a numeric cell — repair the fixture");
  const got = areaOf(rows);
  assert(same(got, { value: 1200.5, unit: "m2" }), `a numeric cell, got ${JSON.stringify(got)}`);
}

/** E6 — `1,200` is refused with the fixed sentence, which does not echo the cell. */
export function assertAGroupedNumberIsRefusedWithoutEcho(): void {
  const message = refusalMessage(buildWorkbookBuffer(rowsWithAreaCells("1,200")), "a floor_area of 1,200");
  assert(message === NOT_A_NUMBER_SENTENCE && !message.includes("1,200"), `got "${message}"`);
}

/** E7 — a negative number is refused with the same sentence. */
export function assertANegativeNumberIsRefused(): void {
  const message = refusalMessage(buildWorkbookBuffer(rowsWithAreaCells("-5")), "a floor_area of -5");
  assert(message === NOT_A_NUMBER_SENTENCE, `got "${message}"`);
}

/** E8 — the unit is trimmed and lower-cased: `FT2 ` is `ft2`. */
export function assertTheUnitIsFolded(): void {
  const got = areaOf(rowsWithAreaCells("1000", "FT2 "));
  assert(same(got, { value: 1000, unit: "ft2" }), `a folded unit, got ${JSON.stringify(got)}`);
}

/** E9 — an unknown unit is refused naming the codes and the length, never the text. */
export function assertAnUnknownUnitIsRefusedWithoutEcho(): void {
  const message = refusalMessage(buildWorkbookBuffer(rowsWithAreaCells("1000", "sqft")), "a floor_area_unit of sqft");
  assert(
    message ===
      "LOCATION row 1 has an unknown floor_area_unit of 4 characters; use one of m2, ft2 and upload the workbook again" &&
      !message.includes("sqft"),
    `got "${message}"`,
  );
}

/** E10 — an empty unit with a value is `m2`. */
export function assertAnEmptyUnitIsM2(): void {
  const got = areaOf(rowsWithAreaCells("1000", ""));
  assert(same(got, { value: 1000, unit: "m2" }), `an empty unit, got ${JSON.stringify(got)}`);
}

/** E11 — a value below the bound parses here; the bound is validate's. */
export function assertAValueBelowTheBoundParses(): void {
  const got = areaOf(rowsWithAreaCells("0.5"));
  assert(same(got, { value: 0.5, unit: "m2" }), `0.5 parses, got ${JSON.stringify(got)}`);
}

/** E12 — exponent notation is refused (a plain decimal literal only). */
export function assertExponentNotationIsRefused(): void {
  const message = refusalMessage(buildWorkbookBuffer(rowsWithAreaCells("1e3")), "a floor_area of 1e3");
  assert(message === NOT_A_NUMBER_SENTENCE, `got "${message}"`);
}

/** E13 — a value followed by a unit in the same cell is refused. */
export function assertAValueWithATrailingUnitIsRefused(): void {
  const message = refusalMessage(buildWorkbookBuffer(rowsWithAreaCells("1200 m2")), "a floor_area of 1200 m2");
  assert(message === NOT_A_NUMBER_SENTENCE, `got "${message}"`);
}
