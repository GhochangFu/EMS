import {
  MAPPING_SHEET_HEADERS,
  MAPPING_SHEET_NAME,
  SOURCE_KEY_RESERVED_VAR,
  TEMPLATES_SHEET_HEADERS,
  TEMPLATES_SHEET_NAME,
  substituteSourceKeyPattern,
} from "@bms/shared";
import * as XLSX from "xlsx";

import { assetPointKey } from "./mapping-sheet-snapshot";
import type { ExportSnapshot, SnapshotTemplatePoint } from "./mapping-sheet-snapshot";

/**
 * The `MAPPINGS` export, pure (`F2.7`, ADR 0056 decision 6): one location's
 * snapshot in, the sheet's rows out, then the rows as an `.xlsx` buffer.
 *
 * The row set, for every **active** asset, ordered by `asset_code` then
 * `point_key`:
 *
 * - every `asset_points` row whose `source_kind` is not `computed`, values as
 *   stored — `rtu_code` via `rtu_id` or blank, `unit` or blank, the five or
 *   blank, `active` as `TRUE`/`FALSE`;
 * - **the pre-fill**: every `measured` template point of the asset's pinned
 *   version with no `asset_points` row for `(asset_id, point_key)` —
 *   `source_data_key` is the pattern with `{asset_code}` substituted and every
 *   other token left literal (`CH{unit}_CHW_SUPPLY_T` for the person to
 *   finish), blank when the pattern is `NULL`; `rtu_code` the asset's own RTU
 *   when that gateway is **active** and blank otherwise (the import refuses a
 *   retired code on a row that does not already carry it, so pre-filling one
 *   would write a cell the import rejects); `unit = template.unit ??
 *   catalog.unit ?? ""`; the five blank;
 *   and `active` **blank** — design decision 4 / Q-B: a blank `active` on a
 *   row with no mapping is "suggestion not taken", which is the only reading
 *   under which this pre-fill and decision 7's round trip (zero creates, zero
 *   updates) both hold with the fixed twelve-column header.
 *
 * Cells are literals — strings and numbers — through `aoa_to_sheet`. Per
 * ADR 0026's XLSX finding the safety is the absence of any `<f>` element:
 * `=1+1` as an asset code is written `<c t="str"><v>=1+1</v></c>`, and nothing
 * instructs Excel to evaluate. `mapping-sheet-export.spec.ts` asserts it on
 * the produced buffer.
 */

/** A sheet cell as written: text (blank is `""`) or a number. */
export type MappingSheetCell = string | number;

/** A stored nullable number as its cell: the number, or blank. */
function numberCell(value: number | null): MappingSheetCell {
  return value ?? "";
}

/** Code-point order, locale-independent, so two exports of one location are byte-identical. */
function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * The header row followed by the export row set, sorted. Every row has exactly
 * twelve cells in `MAPPING_SHEET_HEADERS` order.
 */
export function buildMappingSheetRows(snapshot: ExportSnapshot): MappingSheetCell[][] {
  const codeByAssetId = new Map<string, string>();
  for (const [code, asset] of snapshot.assetsByCode) {
    codeByAssetId.set(asset.id, code);
  }
  const rtuCode = (rtuId: string | null): string => (rtuId === null ? "" : snapshot.rtuCodesById.get(rtuId) ?? "");
  /**
   * A pre-fill row's `rtu_code`, which is blank when the asset's gateway is
   * retired (post-merge code review, finding 4). Step 9 accepts a retired code
   * only where the existing row already points at it; a pre-fill row has no
   * existing row, so writing the code there produced a cell that answers
   * `rtu_not_found` the moment somebody types `TRUE` beside it. Blank means
   * "no gateway", which is what the row would be created as anyway.
   */
  const preFillRtuCode = (rtuId: string | null): string =>
    rtuId !== null && snapshot.activeRtuIds.has(rtuId) ? rtuCode(rtuId) : "";

  const entries: { assetCode: string; pointKey: string; cells: MappingSheetCell[] }[] = [];

  // Existing rows, as stored.
  for (const row of snapshot.existingByAssetPoint.values()) {
    if (row.sourceKind === "computed") {
      continue;
    }
    const code = codeByAssetId.get(row.assetId);
    const asset = code === undefined ? undefined : snapshot.assetsByCode.get(code);
    if (code === undefined || asset === undefined || !asset.active) {
      continue;
    }
    entries.push({
      assetCode: code,
      pointKey: row.pointKey,
      cells: [
        code,
        asset.name,
        row.pointKey,
        rtuCode(row.rtuId),
        row.sourceDataKey,
        row.unit ?? "",
        numberCell(row.metadata.scaleMultiplier),
        numberCell(row.metadata.scaleOffset),
        numberCell(row.metadata.engMin),
        numberCell(row.metadata.engMax),
        row.metadata.qualityPolicy ?? "",
        row.active ? "TRUE" : "FALSE",
      ],
    });
  }

  // The pre-fill: measured template points with no row yet.
  const measuredByTemplate = new Map<string, SnapshotTemplatePoint[]>();
  for (const point of snapshot.templatePoints.values()) {
    if (point.kind !== "measured") {
      continue;
    }
    const list = measuredByTemplate.get(point.templateId);
    if (list) {
      list.push(point);
    } else {
      measuredByTemplate.set(point.templateId, [point]);
    }
  }
  for (const [code, asset] of snapshot.assetsByCode) {
    if (!asset.active || asset.templateId === null) {
      continue;
    }
    for (const point of measuredByTemplate.get(asset.templateId) ?? []) {
      if (snapshot.existingByAssetPoint.has(assetPointKey(asset.id, point.pointKey))) {
        continue;
      }
      const sourceDataKey =
        point.sourceDataKeyPattern === null
          ? ""
          : substituteSourceKeyPattern(point.sourceDataKeyPattern, { [SOURCE_KEY_RESERVED_VAR]: code }).key;
      const unit = point.unit ?? snapshot.catalog.get(point.pointKey)?.unit ?? "";
      entries.push({
        assetCode: code,
        pointKey: point.pointKey,
        cells: [code, asset.name, point.pointKey, preFillRtuCode(asset.rtuId), sourceDataKey, unit, "", "", "", "", "", ""],
      });
    }
  }

  entries.sort((a, b) => compareText(a.assetCode, b.assetCode) || compareText(a.pointKey, b.pointKey));

  return [[...MAPPING_SHEET_HEADERS], ...entries.map((entry) => entry.cells)];
}

/**
 * The read-only `TEMPLATES` sheet (`F2.26`, ADR 0056 Amendment 3): the header
 * row followed by one row per **measured** point of each template version
 * **in use** — pinned by an active asset of the location, the same asset set
 * the `MAPPINGS` rows come from. A version two assets share is listed once:
 * rows are per template, not per asset. Every row has exactly eleven cells in
 * `TEMPLATES_SHEET_HEADERS` order; `source_data_key_pattern` is the pattern as
 * written (no substitution — it is the class, not an asset), and the five are
 * the class defaults, numbers or blank. Sorted by template code, then version
 * numerically, then point key. The import reads `MAPPINGS` by name, so nothing
 * here is ever read back.
 */
export function buildTemplatesSheetRows(snapshot: ExportSnapshot): MappingSheetCell[][] {
  const inUse = new Set<string>();
  for (const asset of snapshot.assetsByCode.values()) {
    if (asset.active && asset.templateId !== null) {
      inUse.add(asset.templateId);
    }
  }

  const entries: { code: string; version: number; pointKey: string; cells: MappingSheetCell[] }[] = [];
  for (const point of snapshot.templatePoints.values()) {
    if (point.kind !== "measured" || !inUse.has(point.templateId)) {
      continue;
    }
    // `assets.template_id` references `asset_templates.id`, so a pinned id the
    // loader read always has its row; a miss would be a loader defect, and a
    // row with no code to name it by is not written.
    const template = snapshot.templatesById.get(point.templateId);
    if (template === undefined) {
      continue;
    }
    entries.push({
      code: template.code,
      version: template.version,
      pointKey: point.pointKey,
      cells: [
        template.code,
        template.version,
        template.name,
        point.pointKey,
        point.unit ?? "",
        point.sourceDataKeyPattern ?? "",
        numberCell(point.defaults.scaleMultiplier),
        numberCell(point.defaults.scaleOffset),
        numberCell(point.defaults.engMin),
        numberCell(point.defaults.engMax),
        point.defaults.qualityPolicy ?? "",
      ],
    });
  }

  entries.sort((a, b) => compareText(a.code, b.code) || a.version - b.version || compareText(a.pointKey, b.pointKey));

  return [[...TEMPLATES_SHEET_HEADERS], ...entries.map((entry) => entry.cells)];
}

/**
 * The rows as an `.xlsx` buffer with one sheet, `MAPPINGS`, every cell a
 * literal. **Single-sheet** — the upload fixtures' writer; the export uses
 * `mappingWorkbookToBuffer`, which adds the `TEMPLATES` sheet (`F2.26`).
 *
 * **Deflated** (post-merge code review, finding 2). `XLSX.write` stores every
 * zip entry uncompressed unless told otherwise, and a mapping sheet is mostly
 * repeated text: a 12,000-row export came to 5.9 MiB (5.15 MiB re-measured on a
 * plainer sheet), over the 5 MiB `MAX_IMPORT_FILE_BYTES` that the *import*
 * enforces — so a location big enough exported a sheet its own preview route
 * refused. Deflating it is a little over 3× on every fixture measured: at the
 * 20,000-row cap 9.98 MiB → 2.13 MiB for the review's export and 8.68 MiB →
 * 2.59 MiB for the plainer one, and that 12,000-row sheet → 1.55 MiB.
 * `mapping-sheet-export.spec.ts` asserts the sheet part's zip method rather
 * than a byte count, because the ratio depends on how full the cells are.
 */
export function mappingSheetToBuffer(rows: SheetRows): Buffer {
  return writeWorkbook([[MAPPING_SHEET_NAME, rows]]);
}

/**
 * The export workbook (`F2.26`, ADR 0056 Amendment 3): `MAPPINGS` first, so
 * Excel opens on the sheet a person edits, then the read-only `TEMPLATES`
 * reference sheet. Deflated and literal-only, as `mappingSheetToBuffer`. The
 * import reads `MAPPINGS` by name, so the second sheet is never read back.
 */
export function mappingWorkbookToBuffer(mappings: SheetRows, templates: SheetRows): Buffer {
  return writeWorkbook([
    [MAPPING_SHEET_NAME, mappings],
    [TEMPLATES_SHEET_NAME, templates],
  ]);
}

type SheetRows = ReadonlyArray<ReadonlyArray<MappingSheetCell>>;

/** The named sheets, in order, as one deflated `.xlsx` buffer of literals. */
function writeWorkbook(sheets: ReadonlyArray<readonly [name: string, rows: SheetRows]>): Buffer {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows.map((row) => [...row])), name);
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}
