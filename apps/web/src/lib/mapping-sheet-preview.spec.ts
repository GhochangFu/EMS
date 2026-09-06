import { expect } from "vitest";

import { MAPPING_SHEET_ERROR_CODES, mappingSheetPreviewDtoSchema } from "@bms/shared/contracts";
import type { MappingSheetCommitDto, MappingSheetErrorDto } from "@bms/shared";

import {
  MAPPING_SHEET_ERROR_LABELS,
  describeMappingSheetUploadError,
  errorsByRow,
  formatMappingSheetCell,
  summarizeMappingCommit,
  summarizeMappingPreview,
} from "./mapping-sheet-preview";

/**
 * `F2.7` / ADR 0056 decisions 6 and 7 — the pure half of the mapping-sheet
 * panel: the label vocabulary, the two summary sentences, the grouping the
 * errors table renders, and the sentence a refused upload turns into.
 *
 * The label record is what makes the API and the web agree on the error
 * vocabulary from the first commit: it is a `Record<MappingSheetErrorCode,
 * string>`, so a code added to `packages/shared` without a label here fails
 * `pnpm build` rather than rendering a blank cell in front of an operator. The
 * first case below is the *runtime* half of that same claim — a label may not
 * be present-but-empty.
 *
 * Assertions live here; `mapping-sheet-preview.test.ts` is the Vitest entry
 * point (ADR 0014).
 */

/** A preview DTO with nothing to write, parsed so the fixture cannot drift from the contract. */
const EMPTY_PREVIEW = mappingSheetPreviewDtoSchema.parse({
  locationId: "11111111-1111-4111-8111-111111111111",
  totalRows: 12,
  creates: [],
  updates: [],
  unchanged: 12,
  untouchedSuggestions: 0,
  errors: [],
});

const CREATE_ROW = {
  row: 4,
  assetCode: "TX01",
  pointKey: "kw",
  rtuCode: "RTU-1",
  sourceDataKey: "TX01_KW",
  unit: "kW",
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
  // Correction 36 — `FALSE` on a pre-fill row creates the mapping inactive, so
  // the flag is part of the create row and not assumed true by the panel.
  active: true,
};

/** A preview with one create, one update, one untouched suggestion and one row error. */
const BUSY_PREVIEW = mappingSheetPreviewDtoSchema.parse({
  locationId: "11111111-1111-4111-8111-111111111111",
  totalRows: 9,
  creates: [CREATE_ROW],
  updates: [
    {
      row: 5,
      assetPointId: "22222222-2222-4222-8222-222222222222",
      assetCode: "TX02",
      pointKey: "kw",
      changes: [{ field: "scaleMultiplier", from: null, to: 0.1 }],
    },
  ],
  unchanged: 4,
  untouchedSuggestions: 2,
  errors: [{ row: 7, column: "rtu_code", code: "rtu_not_found", message: "No active RTU 'RTU-9' here" }],
});

/** Case 1 — every code in the shared vocabulary has a non-empty label. */
export function everyErrorCodeHasALabel(): void {
  for (const code of MAPPING_SHEET_ERROR_CODES) {
    const label = MAPPING_SHEET_ERROR_LABELS[code];
    expect(typeof label, `${code} has no label`).toBe("string");
    expect(label.trim().length, `${code} has an empty label`).toBeGreaterThan(0);
  }
  expect(Object.keys(MAPPING_SHEET_ERROR_LABELS)).toHaveLength(MAPPING_SHEET_ERROR_CODES.length);
}

/**
 * Case 2 — a file-level refusal is a 400 whose body is one `MappingSheetErrorDto`
 * (design decision 7), and the operator sees the label beside the server's own
 * message.
 */
export function aFileLevelRefusalReadsAsLabelAndMessage(): void {
  const message = "Header row does not match the twelve columns: found 'asset' in column 1";
  const sentence = describeMappingSheetUploadError(
    400,
    JSON.stringify({ row: null, column: null, code: "header_mismatch", message }),
  );

  expect(sentence).toContain(MAPPING_SHEET_ERROR_LABELS.header_mismatch);
  expect(sentence).toContain(message);
}

/**
 * Case 3 — anything that is not one of those bodies falls back to a sentence.
 *
 * Three shapes reach here in practice: a framework error page (Multer's 413,
 * raised before the controller runs), an empty body, and a Zod `flatten()` from
 * `parseQuery` — valid JSON that is not this DTO. None may throw, and none may
 * be rendered as `[object Object]`.
 */
export function aBodyThatIsNotAnErrorDtoFallsBack(): void {
  expect(describeMappingSheetUploadError(500, "<html>Internal Server Error</html>")).toContain(
    "<html>Internal Server Error</html>",
  );
  expect(describeMappingSheetUploadError(400, "")).toContain("400");
  expect(describeMappingSheetUploadError(413, "")).toContain("too large");

  const zodFlatten = JSON.stringify({ formErrors: [], fieldErrors: { locationId: ["Required"] } });
  const sentence = describeMappingSheetUploadError(400, zodFlatten);
  expect(sentence).toContain("locationId");
  expect(sentence).not.toContain("[object Object]");
}

/** Case 4 — a sheet that changes nothing says so, in those words. */
export function aPreviewWithNothingToWriteSaysSo(): void {
  expect(summarizeMappingPreview(EMPTY_PREVIEW)).toContain("nothing to write");
  expect(summarizeMappingPreview(EMPTY_PREVIEW)).toContain("12 unchanged");

  const busy = summarizeMappingPreview(BUSY_PREVIEW);
  expect(busy).not.toContain("nothing to write");
  expect(busy).toContain("1 to create");
  expect(busy).toContain("1 to update");
  expect(busy).toContain("4 unchanged");
  // Q-B / design decision 4 — a pre-fill row left blank is not an error and
  // not a write; it has to be counted somewhere the operator can see it.
  expect(busy).toContain("2 suggestions");
  expect(busy).toContain("1 problem");
}

/** Case 5 — the commit banner names what was written and what was skipped. */
export function aCommitSummaryNamesAppliedAndSkipped(): void {
  const commit: MappingSheetCommitDto = {
    locationId: "11111111-1111-4111-8111-111111111111",
    applied: { created: 3, updated: 1 },
    skipped: [{ row: 7, column: "rtu_code", code: "rtu_not_found", message: "No active RTU here" }],
  };
  const sentence = summarizeMappingCommit(commit);
  expect(sentence).toContain("3");
  expect(sentence).toContain("1 updated row");
  expect(sentence).toContain("1 row skipped");

  expect(
    summarizeMappingCommit({ ...commit, applied: { created: 0, updated: 0 }, skipped: [] }),
  ).toContain("Nothing was written");
}

/**
 * Case 6 — errors group by Excel row, file-level ones first.
 *
 * The panel renders one table line per problem, so the grouping is what keeps a
 * row's two problems adjacent instead of interleaved with another row's.
 */
export function errorsGroupByExcelRowFileLevelFirst(): void {
  const errors: MappingSheetErrorDto[] = [
    { row: 9, column: "unit", code: "unit_too_long", message: "over 32 characters" },
    { row: null, column: null, code: "no_data_rows", message: "the sheet has a header and nothing else" },
    { row: 4, column: "point_key", code: "point_key_unknown", message: "not in the catalog" },
    { row: 9, column: "eng_min", code: "eng_range_inverted", message: "eng_max 100 (inherited from the template)" },
  ];

  const grouped = errorsByRow(errors);
  expect(grouped.map((group) => group.row)).toEqual([null, 4, 9]);
  expect(grouped[2]?.errors.map((error) => error.code)).toEqual([
    "unit_too_long",
    "eng_range_inverted",
  ]);
}

/** Case 7 — a cell value renders as the sheet spells it, never as `null`. */
export function cellValuesRenderAsTheSheetSpellsThem(): void {
  expect(formatMappingSheetCell(null)).toBe("—");
  expect(formatMappingSheetCell(true)).toBe("TRUE");
  expect(formatMappingSheetCell(false)).toBe("FALSE");
  expect(formatMappingSheetCell(0.1)).toBe("0.1");
  expect(formatMappingSheetCell("TX01_KW")).toBe("TX01_KW");
}
