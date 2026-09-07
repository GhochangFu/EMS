import { MAPPING_SHEET_HEADERS, MAPPING_SHEET_NAME, SOURCE_KEY_RESERVED_VAR, substituteSourceKeyPattern } from "@bms/shared";
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
 *   or blank; `unit = template.unit ?? catalog.unit ?? ""`; the five blank;
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
        cells: [code, asset.name, point.pointKey, rtuCode(asset.rtuId), sourceDataKey, unit, "", "", "", "", "", ""],
      });
    }
  }

  entries.sort((a, b) => compareText(a.assetCode, b.assetCode) || compareText(a.pointKey, b.pointKey));

  return [[...MAPPING_SHEET_HEADERS], ...entries.map((entry) => entry.cells)];
}

/** The rows as an `.xlsx` buffer with one sheet, `MAPPINGS`, every cell a literal. */
export function mappingSheetToBuffer(rows: ReadonlyArray<ReadonlyArray<MappingSheetCell>>): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows.map((row) => [...row]));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, MAPPING_SHEET_NAME);
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
