import { z } from "zod";

import { pointMetadataShape } from "./point-metadata";

/**
 * `F2.7` / ADR 0056 decisions 6 and 7 — the `MAPPINGS` sheet: the workbook one
 * location exports, and the file the preview and commit routes read back.
 *
 * Everything the API and the web must agree on about the sheet is declared here
 * once: the sheet name, the twelve columns in order, the closed error-code
 * vocabulary (the web's `MAPPING_SHEET_ERROR_LABELS` is typecheck-exhaustive
 * over it, so a code added here without a label fails the build), and the DTOs
 * the two routes return. `apps/api`'s parser, planner and service consume these
 * names; nothing restates them.
 *
 * Every object is all-readonly, so every object schema ends in `.readonly()`
 * (§4.8). The create DTO takes the five metadata fields by **spreading
 * `pointMetadataShape`** into its literal — never `.merge()`, `.extend()` or
 * `z.intersection`: it is not an intersection type, so there is nothing to
 * preserve, and a flattening combinator would only trip
 * `tests/adr-0030-contract-derivation.test.ts`'s source scan.
 */

/** The one sheet an `.xlsx` must carry; a `.csv` has one unnamed sheet and it is used. */
export const MAPPING_SHEET_NAME = "MAPPINGS";

/**
 * The header row, exactly this order, lower-case. A header with anything else —
 * a thirteenth column, a reordering, a missing name — is `header_mismatch` on
 * the file, not on a row: the sheet is `.strict()` in the same sense the bodies
 * are (ADR 0056 decision 7).
 */
export const MAPPING_SHEET_HEADERS = [
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
] as const;

/** One of the twelve column names — what an error's `column` may name. */
export const mappingSheetColumnSchema = z.enum(MAPPING_SHEET_HEADERS);

/**
 * The stable error codes, file-level first (six, reported with `row: null`),
 * then row-level in the import evaluation order the plan fixes. The list is
 * the contract; the message beside a code is for a person and may change.
 */
export const MAPPING_SHEET_ERROR_CODES = [
  // file-level — the whole upload is refused (HTTP 400, body = one error DTO)
  "file_unreadable",
  "file_too_large",
  "sheet_missing",
  "header_mismatch",
  "no_data_rows",
  "too_many_rows",
  // row-level — the row is skipped, the rest of the sheet proceeds
  "asset_code_required",
  "asset_not_found",
  "asset_inactive",
  "point_key_required",
  "point_key_unknown",
  "point_key_computed",
  "duplicate_row",
  "rtu_not_found",
  "source_data_key_required",
  "source_data_key_too_long",
  "source_data_key_unresolved_token",
  "source_data_key_duplicate",
  "unit_too_long",
  "number_invalid",
  "scale_multiplier_zero",
  "quality_policy_invalid",
  "eng_range_inverted",
  "active_invalid",
] as const;

/** The closed error-code vocabulary as a schema. */
export const mappingSheetErrorCodeSchema = z.enum(MAPPING_SHEET_ERROR_CODES);

/**
 * One problem, at file level (`row: null`, and `column: null` — a
 * `header_mismatch` names the offending header in `message`, because the
 * `column` vocabulary is the twelve and the offender by definition is not one)
 * or at row level (`row` is the Excel row number, header = row 1). Same shape
 * both ways so the web renders one table (design decision 7).
 */
export const mappingSheetErrorDtoSchema = z
  .object({
    row: z.number().int().nullable(),
    column: mappingSheetColumnSchema.nullable(),
    code: mappingSheetErrorCodeSchema,
    message: z.string(),
  })
  .readonly();

/**
 * The nine fields the sheet may change on an existing row, by their wire names.
 * `asset_name` is informational (design decision 6) and `source_kind` is
 * derived from `rtu_code` (decision 5), so neither is a field.
 */
export const MAPPING_SHEET_FIELDS = [
  "rtuCode",
  "sourceDataKey",
  "unit",
  "scaleMultiplier",
  "scaleOffset",
  "engMin",
  "engMax",
  "qualityPolicy",
  "active",
] as const;

/** One of the nine editable fields. */
export const mappingSheetFieldSchema = z.enum(MAPPING_SHEET_FIELDS);

/** What a cell resolves to on either side of a change: text, a number, a boolean, or `null` (blank / cleared). */
export const mappingSheetCellValueSchema = z.union([z.string(), z.number(), z.boolean()]).nullable();

/** One field-level change on an existing row — the stored value and the sheet's. */
export const mappingSheetChangeDtoSchema = z
  .object({
    field: mappingSheetFieldSchema,
    from: mappingSheetCellValueSchema,
    to: mappingSheetCellValueSchema,
  })
  .readonly();

/**
 * A row the commit will insert: an `(asset_code, point_key)` with no
 * `asset_points` row yet, whose `active` cell is not blank (a blank one is an
 * untouched suggestion, design decision 4). `unit` is the sheet's, or
 * `template.unit ?? catalog.unit` when the cell is blank (decision 5).
 */
export const mappingSheetCreateDtoSchema = z
  .object({
    row: z.number().int(),
    assetCode: z.string(),
    pointKey: z.string(),
    rtuCode: z.string().nullable(),
    sourceDataKey: z.string(),
    unit: z.string().nullable(),
    ...pointMetadataShape,
    active: z.boolean(),
  })
  .readonly();

/** A row the commit will update, with every field that differs from the stored row. */
export const mappingSheetUpdateDtoSchema = z
  .object({
    row: z.number().int(),
    assetPointId: z.string().uuid(),
    assetCode: z.string(),
    pointKey: z.string(),
    changes: z.array(mappingSheetChangeDtoSchema),
  })
  .readonly();

/**
 * The result of `POST /admin/asset-points/mapping-sheet/preview` — nothing is
 * written. `unchanged` counts existing rows the sheet restates exactly;
 * `untouchedSuggestions` counts pre-fill rows left with a blank `active`
 * (Q-B). A round trip of a location's own export is `creates: []`,
 * `updates: []`, `errors: []` (decision 7).
 */
export const mappingSheetPreviewDtoSchema = z
  .object({
    locationId: z.string().uuid(),
    totalRows: z.number().int(),
    creates: z.array(mappingSheetCreateDtoSchema),
    updates: z.array(mappingSheetUpdateDtoSchema),
    unchanged: z.number().int(),
    untouchedSuggestions: z.number().int(),
    errors: z.array(mappingSheetErrorDtoSchema),
  })
  .readonly();

/**
 * The result of `POST /admin/asset-points/mapping-sheet/commit` — the valid rows
 * were written in one transaction, the rest are returned as `skipped` (Q5).
 */
export const mappingSheetCommitDtoSchema = z
  .object({
    locationId: z.string().uuid(),
    applied: z
      .object({
        created: z.number().int(),
        updated: z.number().int(),
      })
      .readonly(),
    skipped: z.array(mappingSheetErrorDtoSchema),
  })
  .readonly();
