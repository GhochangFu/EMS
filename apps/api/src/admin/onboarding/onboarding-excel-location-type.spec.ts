/**
 * `F4.157` / ADR 0077 decision 7 — the workbook's `type` cell is checked
 * against the live `bms.location_types` codes, and a cell that is empty or
 * unknown refuses the upload.
 *
 * Before this row `parseLocation` replaced anything that was not `rsmoc` or
 * `csmoc` with `smoc_campus`, so a typo became a campus without a word to the
 * operator. The refusal has the `parseRtus` protocol shape: it names the row,
 * the length it read and the codes to choose from, and it never repeats the
 * cell (AGENTS.md §4.3).
 *
 * A sibling of `onboarding-excel.service.spec.ts`, split from it only because
 * the combined file would pass AGENTS.md §4.5's 1,000-line ceiling. The
 * fixture builders are imported from there, so both files describe the
 * workbook the service actually generates.
 */
import { OnboardingExcelService } from "./onboarding-excel.service";
import { buildWorkbookBuffer, refusalMessage, templateRows } from "./onboarding-excel.service.spec";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The four seeded codes, as `OnboardingService.uploadExcel` reads them from the vocabulary. */
const LOCATION_TYPE_CODES = ["smoc_campus", "rsmoc", "csmoc", "pump_station"] as const;

/** Column 3 of the `LOCATION` header: name, code, slug, **type**. */
const TYPE_COLUMN = 3;

/** The template's rows with the one `LOCATION` data row's `type` cell replaced. */
function rowsWithTypeCell(cell: string): (string | number)[][] {
  const rows = templateRows();
  rows[2] = [...rows[2]];
  rows[2][TYPE_COLUMN] = cell;
  return rows;
}

/** The message the upload was refused with, through the sibling files' one helper. */
function refusal(cell: string, what: string): string {
  return refusalMessage(buildWorkbookBuffer(rowsWithTypeCell(cell)), what);
}

/** E1 — an empty cell is refused, naming row 1 and the four codes, and nothing is chosen for it. */
export function assertEmptyLocationTypeIsRefused(): void {
  const message = refusal("", "an empty type cell");
  assert(message.includes("LOCATION row 1"), `the refusal names the row, got "${message}"`);
  assert(message.includes("empty type"), `the refusal says the cell is empty, got "${message}"`);
  for (const code of LOCATION_TYPE_CODES) {
    assert(message.includes(code), `the refusal names the code ${code}, got "${message}"`);
  }
}

/**
 * E2 — an unknown cell is refused by its length, and the cell is not in the
 * message. The positive half is asserted first, in the same case, so the
 * absence check below reads a real refusal and not an empty string.
 *
 * All lower case on purpose: the fold runs before the length is taken, so a
 * lower-case cell is the one whose folded text and raw text are the same
 * string, and the absence check cannot pass merely because the case changed.
 */
export function assertUnknownLocationTypeIsRefusedWithoutEcho(): void {
  const cell = "waterworksdepot";
  const message = refusal(cell, "an unknown type cell");
  assert(
    message.includes(`unknown type of ${cell.length} characters`),
    `the refusal describes the cell by its length, got "${message}"`,
  );
  assert(message.includes("pump_station"), `the refusal names the codes, got "${message}"`);
  assert(!message.includes(cell), `the refusal must not echo the cell, got "${message}"`);
}

/**
 * E3 — a cell in another case is the same code. The trailing space is in the
 * fixture too, but `sectionRows` already trims every cell before
 * `parseLocation` reads it, so only the case half of the fold is observable
 * through `parseUpload`.
 */
export function assertLocationTypeCellIsCaseFolded(): void {
  const parsed = new OnboardingExcelService().parseUpload(
    buildWorkbookBuffer(rowsWithTypeCell("PUMP_STATION ")),
    LOCATION_TYPE_CODES,
  );
  assert(
    parsed.location.type === "pump_station",
    `PUMP_STATION folds to pump_station, got ${JSON.stringify(parsed.location.type)}`,
  );
}

/** Columns 4 and 5 of the `LOCATION` header: **latitude**, **longitude**. */
const LATITUDE_COLUMN = 4;
const LONGITUDE_COLUMN = 5;

/**
 * E4 — `F3.79` (owner ruling 2026-10-04): empty coordinate cells take the Mumbai default, not
 * Pretoria. Every active location is a map pin, so the default is where a new site shows.
 */
export function assertEmptyCoordinateCellsTakeTheMumbaiDefault(): void {
  const rows = rowsWithTypeCell("pump_station");
  rows[2][LATITUDE_COLUMN] = "";
  rows[2][LONGITUDE_COLUMN] = "";
  const parsed = new OnboardingExcelService().parseUpload(buildWorkbookBuffer(rows), LOCATION_TYPE_CODES);
  assert(
    parsed.location.latitude === 19.076 && parsed.location.longitude === 72.8777,
    `empty coordinate cells take Mumbai (19.076, 72.8777), got ` +
      `(${parsed.location.latitude}, ${parsed.location.longitude})`,
  );
}
