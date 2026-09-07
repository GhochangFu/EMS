import { MAPPING_SHEET_HEADERS, MAPPING_SHEET_NAME } from "@bms/shared";
import type { PointMetadataFields } from "@bms/shared";
import * as XLSX from "xlsx";

import { buildMappingSheetRows, mappingSheetToBuffer } from "./mapping-sheet-export";
import { assetPointKey } from "./mapping-sheet-snapshot";
import type { ExistingRow, ExportSnapshot, SnapshotAsset, SnapshotTemplatePoint } from "./mapping-sheet-snapshot";

/**
 * `F2.7` G3 — `buildMappingSheetRows` and `mappingSheetToBuffer`: the export
 * row set of ADR 0056 decision 6 (existing non-computed rows as stored, the
 * template pre-fill with `active` blank per design decision 4), sorted, and
 * written as literals (ADR 0026: no `<f>` element).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const FIVE_NULL: PointMetadataFields = {
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
};

const T1 = "t1";
const T2 = "t2";
const R1 = "r1";

const assets: ReadonlyArray<readonly [string, SnapshotAsset]> = [
  ["TX01", { id: "a1", name: "Transformer 1", active: true, templateId: T1, rtuId: R1 }],
  ["CH01", { id: "a2", name: "Chiller 1", active: true, templateId: T2, rtuId: null }],
  ["OLD1", { id: "a3", name: "Retired", active: false, templateId: T1, rtuId: R1 }],
  ["=1+1", { id: "a4", name: "Formula-looking code", active: true, templateId: null, rtuId: R1 }],
];

const existing: readonly ExistingRow[] = [
  { id: "p1", assetId: "a1", pointKey: "kw", sourceKind: "measured", rtuId: R1, sourceDataKey: "TX01_KW", unit: null, active: true, metadata: FIVE_NULL },
  {
    id: "p2",
    assetId: "a1",
    pointKey: "kw_manual",
    sourceKind: "manual",
    rtuId: null,
    sourceDataKey: "MANUAL_KW",
    unit: "kW",
    active: false,
    metadata: { scaleMultiplier: 0.1, scaleOffset: -40, engMin: 0, engMax: 100, qualityPolicy: "accept_bad" },
  },
  { id: "p3", assetId: "a1", pointKey: "pf", sourceKind: "computed", rtuId: null, sourceDataKey: "TX01_PF", unit: null, active: true, metadata: FIVE_NULL },
  { id: "p4", assetId: "a3", pointKey: "kw", sourceKind: "measured", rtuId: R1, sourceDataKey: "OLD1_KW", unit: null, active: true, metadata: FIVE_NULL },
  { id: "p5", assetId: "a4", pointKey: "kw", sourceKind: "measured", rtuId: R1, sourceDataKey: "EQ_KW", unit: null, active: true, metadata: FIVE_NULL },
];

const templatePoints: readonly SnapshotTemplatePoint[] = [
  { templateId: T1, pointKey: "kw", kind: "measured", unit: null, sourceDataKeyPattern: "{asset_code}_KW", defaults: FIVE_NULL },
  { templateId: T1, pointKey: "kwh", kind: "measured", unit: "kWh", sourceDataKeyPattern: "{asset_code}_KWH", defaults: FIVE_NULL },
  { templateId: T1, pointKey: "pf", kind: "derived", unit: null, sourceDataKeyPattern: null, defaults: FIVE_NULL },
  { templateId: T1, pointKey: "status", kind: "measured", unit: null, sourceDataKeyPattern: null, defaults: FIVE_NULL },
  { templateId: T2, pointKey: "chw_supply_t", kind: "measured", unit: null, sourceDataKeyPattern: "CH{unit}_CHW_SUPPLY_T", defaults: FIVE_NULL },
];

function snapshot(): ExportSnapshot {
  return {
    assetsByCode: new Map(assets),
    existingByAssetPoint: new Map(existing.map((row) => [assetPointKey(row.assetId, row.pointKey), row])),
    rtuCodesById: new Map([[R1, "WC-RTU-1"]]),
    activeRtuIds: new Set([R1]),
    catalog: new Map([
      ["kw", { unit: "kW", active: true }],
      ["kwh", { unit: "kWh", active: true }],
      ["chw_supply_t", { unit: "degC", active: true }],
    ]),
    templatePoints: new Map(templatePoints.map((tp) => [assetPointKey(tp.templateId, tp.pointKey), tp])),
  };
}

/** The header row is the twelve; existing rows carry stored values with TRUE/FALSE; blanks are "". */
export function assertExistingRowsAreWrittenAsStored(): void {
  const rows = buildMappingSheetRows(snapshot());
  assert(JSON.stringify(rows[0]) === JSON.stringify(MAPPING_SHEET_HEADERS), `row 1 is the header, got ${JSON.stringify(rows[0])}`);

  const tx01Kw = rows.find((r) => r[0] === "TX01" && r[2] === "kw");
  assert(
    JSON.stringify(tx01Kw) === JSON.stringify(["TX01", "Transformer 1", "kw", "WC-RTU-1", "TX01_KW", "", "", "", "", "", "", "TRUE"]),
    `the measured row: rtu code via rtu_id, blanks as "", active TRUE — got ${JSON.stringify(tx01Kw)}`,
  );

  const manual = rows.find((r) => r[0] === "TX01" && r[2] === "kw_manual");
  assert(
    JSON.stringify(manual) === JSON.stringify(["TX01", "Transformer 1", "kw_manual", "", "MANUAL_KW", "kW", 0.1, -40, 0, 100, "accept_bad", "FALSE"]),
    `the manual row: no rtu, the five as numbers, active FALSE — got ${JSON.stringify(manual)}`,
  );

  assert(!rows.some((r) => r[2] === "pf"), "a computed row is absent, and so is the derived template point");
  assert(!rows.some((r) => r[0] === "OLD1"), "an inactive asset contributes no rows");
}

/** Pre-fill rows: `{asset_code}` substituted, other tokens literal, the template/catalog unit, the asset's RTU, the five blank, active blank. */
export function assertPreFillRowsFromTheTemplate(): void {
  const rows = buildMappingSheetRows(snapshot());

  const kwh = rows.find((r) => r[0] === "TX01" && r[2] === "kwh");
  assert(
    JSON.stringify(kwh) === JSON.stringify(["TX01", "Transformer 1", "kwh", "WC-RTU-1", "TX01_KWH", "kWh", "", "", "", "", "", ""]),
    `the pre-fill: TX01_KWH, the asset's RTU, the template unit, active blank — got ${JSON.stringify(kwh)}`,
  );

  const chiller = rows.find((r) => r[0] === "CH01");
  assert(
    JSON.stringify(chiller) === JSON.stringify(["CH01", "Chiller 1", "chw_supply_t", "", "CH{unit}_CHW_SUPPLY_T", "degC", "", "", "", "", "", ""]),
    `an un-instantiated token stays literal, no RTU is blank, the catalog unit fills a null template unit — got ${JSON.stringify(chiller)}`,
  );

  const status = rows.find((r) => r[0] === "TX01" && r[2] === "status");
  assert(
    JSON.stringify(status) === JSON.stringify(["TX01", "Transformer 1", "status", "WC-RTU-1", "", "", "", "", "", "", "", ""]),
    `a null pattern and no unit anywhere → blank source key and blank unit — got ${JSON.stringify(status)}`,
  );

  assert(!rows.some((r) => r[0] === "TX01" && r[2] === "kw" && r[11] === ""), "a template point with an existing row is not pre-filled twice");
}

/** Rows are sorted by asset code then point key, code-point order. */
export function assertRowsAreSorted(): void {
  const rows = buildMappingSheetRows(snapshot()).slice(1);
  const keys = rows.map((r) => `${String(r[0])}|${String(r[2])}`);
  const expected = ["=1+1|kw", "CH01|chw_supply_t", "TX01|kw", "TX01|kw_manual", "TX01|kwh", "TX01|status"];
  assert(JSON.stringify(keys) === JSON.stringify(expected), `sorted by asset code then point key, got ${JSON.stringify(keys)}`);
}

/** ADR 0026: the buffer carries literals only — no cell has a formula, and `=1+1` survives as a string. */
export function assertBufferHasNoFormulaCells(): void {
  const rows = buildMappingSheetRows(snapshot());
  const buffer = mappingSheetToBuffer(rows);
  assert(buffer.length > 0, "a buffer was produced");

  const book = XLSX.read(buffer, { type: "buffer" });
  assert(book.SheetNames.length === 1 && book.SheetNames[0] === MAPPING_SHEET_NAME, `one sheet named MAPPINGS, got ${JSON.stringify(book.SheetNames)}`);
  const sheet = book.Sheets[MAPPING_SHEET_NAME];
  assert(sheet !== undefined, "the MAPPINGS sheet is readable");
  if (!sheet) {
    return;
  }

  let cells = 0;
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith("!")) {
      continue;
    }
    cells += 1;
    const typed = cell as XLSX.CellObject;
    assert(typed.f === undefined, `cell ${address} carries a formula: ${String(typed.f)}`);
  }
  assert(cells > 12, `the scan saw the header and data cells, got ${cells}`);

  const formulaLooking = sheet["A2"] as XLSX.CellObject | undefined;
  assert(formulaLooking?.v === "=1+1", `=1+1 survives verbatim, got ${String(formulaLooking?.v)}`);
  // SheetJS reads both `t="s"` (shared string) and `t="str"` (cached formula
  // result, what `aoa_to_sheet` writes for a string) back as `"s"`.
  assert(formulaLooking?.t === "s", `=1+1 is a string cell, got type ${String(formulaLooking?.t)}`);
  assert(formulaLooking?.f === undefined, "=1+1 has no <f> element");

  const numeric = sheet["G5"] as XLSX.CellObject | undefined;
  assert(numeric?.t === "n" && numeric.v === 0.1, `a stored multiplier is a numeric literal, got ${JSON.stringify(numeric)}`);
}

/** One zip central-directory entry, as far as this spec reads it. */
type ZipDirectoryEntry = { readonly name: string; readonly method: number; readonly uncompressed: number };

/**
 * The zip's central directory, walked from the end-of-central-directory record
 * — the same shape `spreadsheet-guard.ts` reads, plus each entry's compression
 * method (the 16-bit field at offset 10; `8` is deflate and `0` is stored).
 */
function zipDirectoryEntries(buffer: Buffer): ZipDirectoryEntry[] {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert(eocd >= 0, "the buffer carries a zip end-of-central-directory record");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipDirectoryEntry[] = [];
  for (let i = 0; i < entryCount; i += 1) {
    assert(buffer.readUInt32LE(offset) === 0x02014b50, `central directory entry ${i + 1} is where the record says it is`);
    const method = buffer.readUInt16LE(offset + 10);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push({ name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString("latin1"), method, uncompressed });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** A snapshot of `count` assets, each with one stored `measured` row — an export of `count` data rows. */
function bulkSnapshot(count: number): ExportSnapshot {
  const bulkAssets: [string, SnapshotAsset][] = [];
  const bulkExisting: ExistingRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const code = `TX${String(i).padStart(5, "0")}`;
    bulkAssets.push([code, { id: `a-${i}`, name: `Transformer ${i}`, active: true, templateId: null, rtuId: R1 }]);
    bulkExisting.push({
      id: `p-${i}`,
      assetId: `a-${i}`,
      pointKey: "kw",
      sourceKind: "measured",
      rtuId: R1,
      sourceDataKey: `${code}_KW`,
      unit: "kW",
      active: true,
      metadata: { ...FIVE_NULL, scaleMultiplier: 0.1 },
    });
  }
  return {
    assetsByCode: new Map(bulkAssets),
    existingByAssetPoint: new Map(bulkExisting.map((r) => [assetPointKey(r.assetId, r.pointKey), r])),
    rtuCodesById: new Map([[R1, "WC-RTU-1"]]),
    activeRtuIds: new Set([R1]),
    catalog: new Map([["kw", { unit: "kW", active: true }]]),
    templatePoints: new Map(),
  };
}

/**
 * Post-merge code review, finding 2 — the workbook is **deflated**.
 *
 * `XLSX.write` stores every zip entry uncompressed unless told otherwise, and
 * an export is mostly repeated text: 12,000 rows came to 5.9 MiB, over the
 * 5 MiB `MAX_IMPORT_FILE_BYTES` its own import enforces, so a location big
 * enough could export a sheet it could not take back. With `compression: true`
 * a 20,000-row export measured 9.98 MiB → 2.13 MiB.
 *
 * The assertion is on the zip itself, not on the size: the sheet part is stored
 * with method 8, and the buffer still reads back as the same rows.
 */
export function assertTheBufferIsDeflatedAndStillParses(): void {
  const rows = buildMappingSheetRows(bulkSnapshot(2_000));
  assert(rows.length === 2_001, `the fixture is the header and 2,000 data rows, got ${rows.length}`);
  const buffer = mappingSheetToBuffer(rows);

  const entries = zipDirectoryEntries(buffer);
  const sheetEntry = entries.find((entry) => entry.name.endsWith("sheet1.xml"));
  assert(sheetEntry !== undefined, `the workbook carries a sheet part, got ${JSON.stringify(entries.map((e) => e.name))}`);
  assert(sheetEntry!.method === 8, `the sheet part is deflated (method 8), got ${sheetEntry!.method}`);
  assert(
    buffer.length < sheetEntry!.uncompressed,
    `the whole file is smaller than the sheet part unpacked (${buffer.length} vs ${sheetEntry!.uncompressed} bytes)`,
  );

  const book = XLSX.read(buffer, { type: "buffer" });
  const sheet = book.Sheets[MAPPING_SHEET_NAME];
  assert(sheet !== undefined, "the deflated workbook still carries the MAPPINGS sheet");
  const readBack = XLSX.utils.sheet_to_json<unknown[]>(sheet as XLSX.WorkSheet, { header: 1, defval: "" });
  assert(readBack.length === 2_001, `the deflated buffer reads back as the header and 2,000 rows, got ${readBack.length}`);
  assert(String(readBack[2_000]?.[0]) === "TX01999", `the last row survives, got ${JSON.stringify(readBack[2_000]?.[0])}`);
}

/**
 * Post-merge code review, finding 4 — a **pre-fill** row never names a retired
 * gateway.
 *
 * `rtuCodesById` holds every RTU of the location, retired included, so that an
 * existing row still names the gateway it is wired to (correction 39). A
 * pre-fill row has no existing row, so step 9's exception does not cover it:
 * writing the retired code there produced a cell that answers `rtu_not_found`
 * the moment somebody types `TRUE` beside it. The pre-fill leaves it blank
 * instead — the row is then created unmapped, which is what the export means by
 * a blank `rtu_code` (design decision 5).
 */
export function assertARetiredGatewayIsNotPreFilled(): void {
  const base = snapshot();
  const retiredId = "r-retired";
  const retiredCode = "WC-RTU-RETIRED";
  const wired: ExistingRow = {
    id: "p6",
    assetId: "a5",
    pointKey: "kw",
    sourceKind: "measured",
    rtuId: retiredId,
    sourceDataKey: "CH02_KW",
    unit: null,
    active: true,
    metadata: FIVE_NULL,
  };
  const snap: ExportSnapshot = {
    ...base,
    assetsByCode: new Map([
      ...base.assetsByCode,
      ["CH02", { id: "a5", name: "Chiller 2", active: true, templateId: T2, rtuId: retiredId }],
    ]),
    existingByAssetPoint: new Map([...base.existingByAssetPoint, [assetPointKey("a5", "kw"), wired]]),
    // Every RTU of the location by id, retired included; the active set is the
    // one the pre-fill reads.
    rtuCodesById: new Map([...base.rtuCodesById, [retiredId, retiredCode]]),
  };
  assert(!snap.activeRtuIds.has(retiredId), "the fixture gateway is retired, so it is absent from activeRtuIds");

  const rows = buildMappingSheetRows(snap);
  const preFill = rows.find((r) => r[0] === "CH02" && r[2] === "chw_supply_t");
  assert(preFill !== undefined, `the retired asset still gets its pre-fill row, got ${JSON.stringify(rows.map((r) => r[0]))}`);
  assert(preFill?.[3] === "", `a pre-fill row of an asset on a retired gateway leaves rtu_code blank, got ${JSON.stringify(preFill?.[3])}`);

  const stored = rows.find((r) => r[0] === "CH02" && r[2] === "kw");
  assert(
    stored?.[3] === retiredCode,
    `an existing row still names the retired gateway it is wired to (correction 39), got ${JSON.stringify(stored?.[3])}`,
  );

  // The live gateway is untouched by the rule: TX01's pre-fill still names it.
  const live = rows.find((r) => r[0] === "TX01" && r[2] === "kwh");
  assert(live?.[3] === "WC-RTU-1", `a pre-fill row on an active gateway still names it, got ${JSON.stringify(live?.[3])}`);
}
