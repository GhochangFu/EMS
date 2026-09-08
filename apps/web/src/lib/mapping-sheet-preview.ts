import { mappingSheetErrorDtoSchema } from "@bms/shared/contracts";
import type {
  MappingSheetCellValue,
  MappingSheetCommitDto,
  MappingSheetErrorCode,
  MappingSheetErrorDto,
  MappingSheetPreviewDto,
} from "@bms/shared";

import { oversizeUploadMessage } from "./oversize-upload";

/**
 * `F2.7` / ADR 0056 decisions 6 and 7 — the pure rules behind the mapping-sheet
 * panel: what each error code is called in front of an operator, what a preview
 * and a commit say in one line, how the errors table is ordered, and what a
 * refused upload turns into.
 *
 * The panel is wiring; every sentence and every ordering decision lives here so
 * it can be asserted without a DOM (`mapping-sheet-preview.spec.ts`).
 *
 * **{@link MAPPING_SHEET_ERROR_LABELS} is a `Record` over the shared code
 * union on purpose.** `packages/shared` owns the vocabulary; a code added there
 * without a label here fails `pnpm build` rather than reaching an operator as a
 * blank cell. That compile-time link is what the plan means by "the API and the
 * web agree from the first commit" — the runtime half (no label is empty) is
 * the spec's first case.
 */

/** How each error code reads in the panel's table. The message beside it is the server's. */
export const MAPPING_SHEET_ERROR_LABELS: Record<MappingSheetErrorCode, string> = {
  // File-level — the whole upload was refused (HTTP 400, one error DTO, `row: null`).
  file_unreadable: "File cannot be read",
  file_too_large: "File is too large",
  sheet_missing: "No MAPPINGS sheet",
  header_mismatch: "Header row does not match",
  no_data_rows: "No data rows",
  too_many_rows: "Too many rows",
  // Row-level — the row was skipped, the rest of the sheet proceeded.
  asset_code_required: "Asset code is required",
  asset_not_found: "Asset is not in this location",
  asset_inactive: "Asset is inactive",
  point_key_required: "Point key is required",
  point_key_unknown: "Point key is not known here",
  point_key_computed: "Computed point",
  duplicate_row: "Duplicate row",
  rtu_not_found: "RTU not found here",
  source_data_key_required: "Source data key is required",
  source_data_key_too_long: "Source data key is too long",
  source_data_key_unresolved_token: "Source data key still holds a token",
  source_data_key_duplicate: "Source data key is used twice",
  unit_too_long: "Unit is too long",
  number_invalid: "Not a number",
  scale_multiplier_zero: "Scale multiplier is 0",
  quality_policy_invalid: "Quality policy is not one of the two",
  eng_range_inverted: "Engineering range is inverted",
  active_invalid: "Active is not TRUE or FALSE",
};

/** `3 rows` / `1 row`, so no sentence here reads "1 rows". */
function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Turns a non-OK upload response into a sentence worth showing an operator.
 *
 * Three bodies reach here and only the first is this feature's own shape:
 *
 * - a `MappingSheetErrorDto` — every file-level refusal (design decision 7),
 *   rendered as its label plus the server's message, which is the one that
 *   names the offending header or the row cap;
 * - a Zod `flatten()` — a missing or misspelt `locationId`, refused by
 *   `mappingSheetQuerySchema` before the file is read. Valid JSON, not this
 *   DTO, so it falls through to the raw body rather than being mis-labelled;
 * - a 413, which `oversizeUploadMessage` answers. **Not a framework error
 *   page** — this clause said that until `F4.106` measured it. Nest maps
 *   multer's `LIMIT_FILE_SIZE` to `PayloadTooLargeException`, so the body is
 *   the ordinary envelope; the special case exists to add the 5 MB figure that
 *   `File too large` does not carry. A reverse proxy's own HTML 413 lands here
 *   too and gets the same sentence.
 *
 * The 413 check runs **after** the DTO parse, so the API's own `file_too_large`
 * still wins and keeps its label. That one is a **400**, not a 413:
 * `parseMappingSheet` refuses the buffer itself with a message naming the
 * actual byte count and the limit, and refuses a zip that *declares* an
 * oversized inflation under the same code. Both say more than this sentence
 * does, and neither reaches the 413 branch.
 *
 * It never throws: a panel that cannot render the refusal is worse than one
 * that renders it plainly.
 */
export function describeMappingSheetUploadError(status: number, bodyText: string): string {
  const parsed = parseErrorDto(bodyText);
  if (parsed) {
    return `${MAPPING_SHEET_ERROR_LABELS[parsed.code]} — ${parsed.message}`;
  }
  const oversize = oversizeUploadMessage(status);
  if (oversize !== null) {
    return oversize;
  }
  return bodyText.trim() || `Mapping sheet upload failed (${status}).`;
}

/** The body as one error DTO, or `null` for anything else — including valid JSON of another shape. */
function parseErrorDto(bodyText: string): MappingSheetErrorDto | null {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const result = mappingSheetErrorDtoSchema.safeParse(body);
  return result.success ? result.data : null;
}

/**
 * One line over a preview: what would be written, and what would not.
 *
 * `untouchedSuggestions` is named whenever it is non-zero because it is the
 * count with no other surface — a pre-fill row left with a blank `active` cell
 * is neither a write nor an error (design decision 4 / Q-B), so an operator who
 * expected 40 new mappings and typed `TRUE` on 12 of them can only tell here.
 */
export function summarizeMappingPreview(dto: MappingSheetPreviewDto): string {
  const writes = dto.creates.length + dto.updates.length;
  const head =
    writes === 0 ? "This sheet has nothing to write" : `Ready to write ${countOf(writes, "row")}`;
  const detail = [
    `${countOf(dto.totalRows, "data row")} read`,
    `${dto.creates.length} to create`,
    `${dto.updates.length} to update`,
    `${dto.unchanged} unchanged`,
  ];
  if (dto.untouchedSuggestions > 0) {
    detail.push(`${countOf(dto.untouchedSuggestions, "suggestion")} not taken`);
  }
  if (dto.errors.length > 0) {
    detail.push(`${countOf(dto.errors.length, "problem")} to fix`);
  }
  return `${head} — ${detail.join(", ")}.`;
}

/**
 * One line over a commit: what was written, and how many rows were skipped.
 *
 * "Valid rows only" is the owner's Q5 ruling, so a commit with skipped rows is
 * a success and not a failure — the banner has to state both halves or the
 * operator reads a green result and never re-opens the file.
 */
export function summarizeMappingCommit(dto: MappingSheetCommitDto): string {
  const { created, updated } = dto.applied;
  const head =
    created + updated === 0
      ? "Nothing was written"
      : `Wrote ${countOf(created, "new row")} and ${countOf(updated, "updated row")}`;
  const tail = dto.skipped.length > 0 ? ` ${countOf(dto.skipped.length, "row")} skipped.` : "";
  return `${head}.${tail}`;
}

/** One Excel row's problems, in the order the server reported them. */
export type MappingSheetRowErrors = {
  /** The Excel row (header = row 1), or `null` for a problem with the file itself. */
  row: number | null;
  errors: MappingSheetErrorDto[];
};

/**
 * Groups problems by Excel row, file-level ones first and then ascending.
 *
 * The table renders one line per problem, not per row, because a person fixing
 * a sheet works cell by cell — the grouping only keeps one row's two problems
 * adjacent instead of interleaved with another row's.
 */
export function errorsByRow(errors: readonly MappingSheetErrorDto[]): MappingSheetRowErrors[] {
  const groups = new Map<number | null, MappingSheetErrorDto[]>();
  for (const error of errors) {
    const bucket = groups.get(error.row);
    if (bucket) {
      bucket.push(error);
    } else {
      groups.set(error.row, [error]);
    }
  }
  return [...groups.entries()]
    .map(([row, rowErrors]) => ({ row, errors: rowErrors }))
    .sort((a, b) => {
      if (a.row === b.row) return 0;
      if (a.row === null) return -1;
      if (b.row === null) return 1;
      return a.row - b.row;
    });
}

/**
 * A cell value as the sheet spells it: `TRUE`/`FALSE` for a boolean, an em dash
 * for `null` (a blank cell, which on the five means "inherit").
 */
export function formatMappingSheetCell(value: MappingSheetCellValue): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}
