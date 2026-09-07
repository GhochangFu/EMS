import {
  MAPPING_SHEET_ERROR_CODES,
  MAPPING_SHEET_FIELDS,
  MAPPING_SHEET_HEADERS,
  MAPPING_SHEET_NAME,
  mappingSheetChangeDtoSchema,
  mappingSheetColumnSchema,
  mappingSheetCommitDtoSchema,
  mappingSheetCreateDtoSchema,
  mappingSheetErrorCodeSchema,
  mappingSheetErrorDtoSchema,
  mappingSheetFieldSchema,
  mappingSheetPreviewDtoSchema,
  mappingSheetUpdateDtoSchema,
} from "./mapping-sheet";

/**
 * `F2.7` / ADR 0056 decisions 6 and 7 — the `MAPPINGS` sheet contract: the
 * twelve columns, the 24 error codes and the preview/commit DTOs.
 *
 * Assertions live here; `mapping-sheet.test.ts` is the vitest entry point
 * (ADR 0014). Everything in this file is a plain object and needs no connection.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectAccepts(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
  message: string,
): void {
  assert(schema.safeParse(value).success === true, `${message} — expected success, got a refusal`);
}

function expectRejects(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
  message: string,
): void {
  assert(schema.safeParse(value).success === false, `${message} — expected a refusal, got success`);
}

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_POINT_ID = "22222222-2222-4222-8222-222222222222";

const rowError = {
  row: 7,
  column: "scale_multiplier",
  code: "number_invalid",
  message: "scale_multiplier 'abc' is not a finite number",
};

const fileError = {
  row: null,
  column: null,
  code: "header_mismatch",
  message: "Column 13 is 'sensor_code'; the header must be exactly the twelve",
};

const create = {
  row: 2,
  assetCode: "TX01",
  pointKey: "kw",
  rtuCode: "WC-RTU-1",
  sourceDataKey: "TX01_KW",
  unit: "kW",
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: 0,
  engMax: 100,
  qualityPolicy: null,
  active: true,
};

const change = { field: "sourceDataKey", from: "TX01_KW", to: "TX01_KW_2" };

const update = {
  row: 3,
  assetPointId: ASSET_POINT_ID,
  assetCode: "TX01",
  pointKey: "kw",
  changes: [change, { field: "active", from: true, to: false }, { field: "engMax", from: null, to: 100 }],
};

const preview = {
  locationId: LOCATION_ID,
  totalRows: 4,
  creates: [create],
  updates: [update],
  unchanged: 1,
  untouchedSuggestions: 1,
  errors: [rowError],
};

const commit = {
  locationId: LOCATION_ID,
  applied: { created: 1, updated: 1 },
  skipped: [rowError],
};

/** The header tuple is the twelve, in the ADR's order, and the sheet has one name. */
export function assertHeaderIsTheTwelveInOrder(): void {
  assert(MAPPING_SHEET_NAME === "MAPPINGS", `the sheet is named MAPPINGS, got ${MAPPING_SHEET_NAME}`);
  const expected = [
    "asset_code",
    "asset_name",
    "point_key",
    "rtu_code",
    "source_data_key",
    "unit",
    "scale_multiplier",
    "scale_offset",
    "eng_min",
    "eng_max",
    "quality_policy",
    "active",
  ];
  assert(
    JSON.stringify(MAPPING_SHEET_HEADERS) === JSON.stringify(expected),
    `MAPPING_SHEET_HEADERS must be the twelve in order, got ${JSON.stringify(MAPPING_SHEET_HEADERS)}`,
  );
  assert(
    JSON.stringify(mappingSheetColumnSchema.options) === JSON.stringify(expected),
    "mappingSheetColumnSchema is built from MAPPING_SHEET_HEADERS, not restated",
  );
  expectRejects(mappingSheetColumnSchema, "sensor_code", "a thirteenth column name is not a column");
  expectRejects(mappingSheetColumnSchema, "Asset_Code", "the column vocabulary is lower-case");
}

/** The error-code list has exactly 24 distinct entries and the schema is built from it. */
export function assertErrorCodesAre24Distinct(): void {
  assert(
    MAPPING_SHEET_ERROR_CODES.length === 24,
    `the plan's table names 24 codes, got ${MAPPING_SHEET_ERROR_CODES.length}`,
  );
  assert(
    new Set(MAPPING_SHEET_ERROR_CODES).size === MAPPING_SHEET_ERROR_CODES.length,
    "every error code is distinct",
  );
  assert(
    JSON.stringify(mappingSheetErrorCodeSchema.options) === JSON.stringify(MAPPING_SHEET_ERROR_CODES),
    "mappingSheetErrorCodeSchema is built from MAPPING_SHEET_ERROR_CODES, not restated",
  );
  const fileLevel = ["file_unreadable", "file_too_large", "sheet_missing", "header_mismatch", "no_data_rows", "too_many_rows"];
  for (const code of fileLevel) {
    assert(MAPPING_SHEET_ERROR_CODES.includes(code as (typeof MAPPING_SHEET_ERROR_CODES)[number]), `file-level code ${code} is present`);
  }
  for (const code of ["eng_range_inverted", "source_data_key_duplicate", "active_invalid", "point_key_computed"]) {
    assert(MAPPING_SHEET_ERROR_CODES.includes(code as (typeof MAPPING_SHEET_ERROR_CODES)[number]), `row-level code ${code} is present`);
  }
  expectRejects(mappingSheetErrorCodeSchema, "unknown_code", "an unlisted code is refused");
}

/** The error DTO is one shape both ways — `row: null` for a file-level refusal. */
export function assertErrorDtoAcceptsBothLevels(): void {
  expectAccepts(mappingSheetErrorDtoSchema, rowError, "a row-level error");
  expectAccepts(mappingSheetErrorDtoSchema, fileError, "a file-level error with row and column null");
  expectRejects(mappingSheetErrorDtoSchema, { ...rowError, code: "not_a_code" }, "an unknown code is refused");
  expectRejects(mappingSheetErrorDtoSchema, { ...rowError, column: "sensor_code" }, "an unknown column is refused");
  expectRejects(mappingSheetErrorDtoSchema, { ...rowError, row: 7.5 }, "a row number is an integer");
  expectRejects(mappingSheetErrorDtoSchema, { row: 7, column: "unit", code: "unit_too_long" }, "message is required");
}

/** The change DTO names one of the nine editable fields and carries a cell value either side. */
export function assertChangeDtoBindsTheFieldVocabulary(): void {
  const expected = [
    "rtuCode",
    "sourceDataKey",
    "unit",
    "scaleMultiplier",
    "scaleOffset",
    "engMin",
    "engMax",
    "qualityPolicy",
    "active",
  ];
  assert(
    JSON.stringify(MAPPING_SHEET_FIELDS) === JSON.stringify(expected),
    `MAPPING_SHEET_FIELDS must be the nine editable fields, got ${JSON.stringify(MAPPING_SHEET_FIELDS)}`,
  );
  assert(
    JSON.stringify(mappingSheetFieldSchema.options) === JSON.stringify(MAPPING_SHEET_FIELDS),
    "mappingSheetFieldSchema is built from MAPPING_SHEET_FIELDS",
  );
  expectAccepts(mappingSheetChangeDtoSchema, change, "a string change");
  expectAccepts(mappingSheetChangeDtoSchema, { field: "active", from: true, to: false }, "a boolean change");
  expectAccepts(mappingSheetChangeDtoSchema, { field: "engMin", from: null, to: 0 }, "null to a number");
  expectAccepts(mappingSheetChangeDtoSchema, { field: "unit", from: "kW", to: null }, "a clear to null");
  expectRejects(mappingSheetChangeDtoSchema, { field: "assetName", from: "a", to: "b" }, "asset_name is informational, never a change");
  expectRejects(mappingSheetChangeDtoSchema, { field: "sourceKind", from: "measured", to: "unmapped" }, "source_kind is derived, never a change");
  expectRejects(mappingSheetChangeDtoSchema, { field: "engMin", from: undefined, to: 0 }, "from is required (null, not absent)");
}

/** The create and update DTOs accept a fixture and refuse a missing or unknown key. */
export function assertCreateAndUpdateDtos(): void {
  expectAccepts(mappingSheetCreateDtoSchema, create, "a create with a wired RTU");
  expectAccepts(mappingSheetCreateDtoSchema, { ...create, rtuCode: null, unit: null }, "a create with no RTU and no unit");
  expectRejects(mappingSheetCreateDtoSchema, { ...create, active: null }, "a create's active is a boolean, never blank");
  expectRejects(mappingSheetCreateDtoSchema, { ...create, qualityPolicy: "clamp" }, "the policy enum binds on the create");
  const { engMin: _dropped, ...createWithoutEngMin } = create;
  void _dropped;
  expectRejects(mappingSheetCreateDtoSchema, createWithoutEngMin, "the five are required nullable keys on the create");

  expectAccepts(mappingSheetUpdateDtoSchema, update, "an update with three changes");
  expectAccepts(mappingSheetUpdateDtoSchema, { ...update, changes: [] }, "an empty change list parses (the planner never emits one)");
  expectRejects(mappingSheetUpdateDtoSchema, { ...update, assetPointId: "not-a-uuid" }, "assetPointId is a uuid");
  expectRejects(
    mappingSheetUpdateDtoSchema,
    { ...update, changes: [{ field: "assetName", from: "a", to: "b" }] },
    "an update refuses a change on an unknown field",
  );
}

/** The preview DTO requires `untouchedSuggestions` (design decision 4 / Q-B) and the commit DTO its `applied` pair. */
export function assertPreviewAndCommitDtos(): void {
  expectAccepts(mappingSheetPreviewDtoSchema, preview, "a preview fixture");
  const { untouchedSuggestions: _u, ...previewWithoutUntouched } = preview;
  void _u;
  expectRejects(mappingSheetPreviewDtoSchema, previewWithoutUntouched, "untouchedSuggestions is required on the preview");
  expectRejects(mappingSheetPreviewDtoSchema, { ...preview, unchanged: "1" }, "unchanged is a number");
  expectRejects(mappingSheetPreviewDtoSchema, { ...preview, locationId: "loc" }, "locationId is a uuid");
  expectRejects(
    mappingSheetPreviewDtoSchema,
    { ...preview, errors: [{ ...rowError, code: "not_a_code" }] },
    "an unknown code inside errors[] is refused",
  );

  expectAccepts(mappingSheetCommitDtoSchema, commit, "a commit fixture");
  expectAccepts(mappingSheetCommitDtoSchema, { ...commit, skipped: [] }, "a commit that skipped nothing");
  expectRejects(mappingSheetCommitDtoSchema, { ...commit, applied: { created: 1 } }, "applied needs both counts");
  expectRejects(
    mappingSheetCommitDtoSchema,
    { ...commit, skipped: [{ ...rowError, column: "sensor_code" }] },
    "an unknown column inside skipped[] is refused",
  );
}
