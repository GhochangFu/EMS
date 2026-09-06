import { MAPPING_SHEET_HEADERS, mappingSheetCreateDtoSchema, mappingSheetUpdateDtoSchema } from "@bms/shared";
import type { MappingSheetChangeDto, MappingSheetErrorCode, PointMetadataFields } from "@bms/shared";
import * as XLSX from "xlsx";

import { buildMappingSheetRows, mappingSheetToBuffer } from "./mapping-sheet-export";
import { planMappingSheet } from "./mapping-sheet-plan";
import type { MappingSheetPlan } from "./mapping-sheet-plan";
import { parseMappingSheet } from "./mapping-sheet-rows";
import type { ParsedMappingRow } from "./mapping-sheet-rows";
import { assetPointKey, assetSourceKey } from "./mapping-sheet-snapshot";
import type { ExistingRow, PlanSnapshot, SnapshotAsset, SnapshotTemplatePoint } from "./mapping-sheet-snapshot";

/**
 * `F2.7` G4 — `planMappingSheet`: steps 5–15 of the import evaluation order
 * against one location's snapshot. Rows reach the planner through the real
 * parser (a sheet built with `aoa_to_sheet`), so every case here is the same
 * code path the service runs, and the identity property is asserted end to end:
 * export → buffer → parse → plan, on one snapshot.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Cell = string | number | boolean;
type Column = (typeof MAPPING_SHEET_HEADERS)[number];

const FIVE_NULL: PointMetadataFields = {
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
};

const T1 = "t1";
const R1 = "r1";
const R2 = "r2";

/** `asset_points.id` is a uuid and the update DTO says so; the fixture ids must be real ones. */
function pointId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const assets: ReadonlyArray<readonly [string, SnapshotAsset]> = [
  ["TX01", { id: "a1", name: "Transformer 1", active: true, templateId: T1, rtuId: R1 }],
  ["TX02", { id: "a2", name: "Transformer 2", active: true, templateId: T1, rtuId: null }],
  ["OLD1", { id: "a3", name: "Retired", active: false, templateId: T1, rtuId: R1 }],
  ["NOTPL", { id: "a4", name: "No template", active: true, templateId: null, rtuId: R1 }],
];

const existing: readonly ExistingRow[] = [
  { id: pointId(1), assetId: "a1", pointKey: "kw", sourceKind: "measured", rtuId: R1, sourceDataKey: "TX01_KW", unit: null, active: true, metadata: FIVE_NULL },
  { id: pointId(2), assetId: "a1", pointKey: "kw_manual", sourceKind: "manual", rtuId: null, sourceDataKey: "MANUAL_KW", unit: "kW", active: true, metadata: FIVE_NULL },
  { id: pointId(3), assetId: "a1", pointKey: "pf", sourceKind: "computed", rtuId: null, sourceDataKey: "TX01_PF", unit: null, active: true, metadata: FIVE_NULL },
  { id: pointId(4), assetId: "a1", pointKey: "kwh", sourceKind: "measured", rtuId: R1, sourceDataKey: "TX01_KWH", unit: "kWh", active: true, metadata: FIVE_NULL },
  { id: pointId(5), assetId: "a2", pointKey: "kw", sourceKind: "unmapped", rtuId: null, sourceDataKey: "TX02_KW", unit: null, active: true, metadata: FIVE_NULL },
  { id: pointId(6), assetId: "a3", pointKey: "kw", sourceKind: "measured", rtuId: R1, sourceDataKey: "OLD1_KW", unit: null, active: true, metadata: FIVE_NULL },
  { id: pointId(7), assetId: "a4", pointKey: "kw", sourceKind: "measured", rtuId: R1, sourceDataKey: "NOTPL_KW", unit: null, active: false, metadata: FIVE_NULL },
];

const templatePoints: readonly SnapshotTemplatePoint[] = [
  { templateId: T1, pointKey: "kw", kind: "measured", unit: null, sourceDataKeyPattern: "{asset_code}_KW", defaults: FIVE_NULL },
  { templateId: T1, pointKey: "kwh", kind: "measured", unit: "kWh", sourceDataKeyPattern: "{asset_code}_KWH", defaults: { ...FIVE_NULL, engMax: 100 } },
  { templateId: T1, pointKey: "pf", kind: "derived", unit: null, sourceDataKeyPattern: null, defaults: FIVE_NULL },
  { templateId: T1, pointKey: "pressure", kind: "measured", unit: "bar", sourceDataKeyPattern: "{asset_code}_P", defaults: { ...FIVE_NULL, engMin: 0, engMax: 10 } },
];

function snapshot(): PlanSnapshot {
  return {
    assetsByCode: new Map(assets),
    existingByAssetPoint: new Map(existing.map((row) => [assetPointKey(row.assetId, row.pointKey), row])),
    existingByAssetSource: new Map(existing.map((row) => [assetSourceKey(row.assetId, row.sourceDataKey), row.pointKey])),
    rtuCodesById: new Map([
      [R1, "WC-RTU-1"],
      [R2, "WC-RTU-2"],
    ]),
    rtusByCode: new Map([
      ["WC-RTU-1", R1],
      ["WC-RTU-2", R2],
    ]),
    catalog: new Map([
      ["kw", { unit: "kW", active: true }],
      ["kwh", { unit: "kWh", active: true }],
      ["kw_manual", { unit: "kW", active: true }],
      ["temp", { unit: "degC", active: true }],
      ["pf", { unit: null, active: true }],
      ["dead", { unit: null, active: false }],
    ]),
    templatePoints: new Map(templatePoints.map((tp) => [assetPointKey(tp.templateId, tp.pointKey), tp])),
  };
}

/** A complete data row; override cells by column name. */
function row(overrides: Partial<Record<Column, Cell>> = {}): Cell[] {
  const base: Record<Column, Cell> = {
    asset_code: "TX01",
    asset_name: "Transformer 1",
    point_key: "kw",
    rtu_code: "WC-RTU-1",
    source_data_key: "TX01_KW",
    unit: "",
    scale_multiplier: "",
    scale_offset: "",
    eng_min: "",
    eng_max: "",
    quality_policy: "",
    active: "TRUE",
    ...overrides,
  };
  return MAPPING_SHEET_HEADERS.map((column) => base[column]);
}

/** Builds an xlsx from the rows and runs the real parser; a parse-level error here is a fixture mistake. */
function parsed(dataRows: Cell[][]): ParsedMappingRow[] {
  const sheet = XLSX.utils.aoa_to_sheet([[...MAPPING_SHEET_HEADERS], ...dataRows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "MAPPINGS");
  const result = parseMappingSheet(XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer);
  assert(result.ok, `the fixture sheet parses: ${result.ok ? "" : JSON.stringify(result.error)}`);
  if (!result.ok) {
    throw new Error("unreachable");
  }
  assert(result.errors.length === 0, `the fixture sheet has no parse-level errors: ${JSON.stringify(result.errors)}`);
  return result.rows;
}

function plan(dataRows: Cell[][]): MappingSheetPlan {
  return planMappingSheet(parsed(dataRows), snapshot());
}

function summary(p: MappingSheetPlan): string {
  return JSON.stringify({
    creates: p.creates.length,
    updates: p.updates.length,
    unchanged: p.unchanged,
    untouched: p.untouchedSuggestions,
    errors: p.errors.map((e) => `${e.row}:${e.column}:${e.code}`),
  });
}

function onlyError(p: MappingSheetPlan, code: MappingSheetErrorCode, column: Column, what: string): string {
  assert(p.errors.length === 1, `${what}: one error, got ${summary(p)}`);
  const error = p.errors[0];
  assert(error?.code === code, `${what}: code ${code}, got ${error?.code}`);
  assert(error?.column === column, `${what}: column ${column}, got ${error?.column}`);
  assert(error?.row === 2, `${what}: the Excel row number, got ${error?.row}`);
  assert(p.creates.length === 0 && p.updates.length === 0 && p.unchanged === 0 && p.untouchedSuggestions === 0, `${what}: nothing else, got ${summary(p)}`);
  return error?.message ?? "";
}

function onlyUpdate(p: MappingSheetPlan, what: string): MappingSheetChangeDto[] {
  assert(p.updates.length === 1 && p.creates.length === 0 && p.errors.length === 0, `${what}: one update, got ${summary(p)}`);
  const update = p.updates[0];
  assert(update !== undefined, "unreachable");
  assert(mappingSheetUpdateDtoSchema.safeParse(p.previewUpdates[0]).success, `${what}: the preview update parses against its DTO`);
  return update ? [...update.changes] : [];
}

/**
 * The named identity test: a location's own export, parsed and planned against
 * the same snapshot, changes nothing — `creates 0`, `updates 0`, `errors 0`;
 * `unchanged` is every existing non-computed row of an active asset,
 * `untouchedSuggestions` is every pre-fill row (design decision 4, Q-B). ADR
 * 0056 decision 7: "that round-trip is a test, not a hope".
 */
export function assertExportedRowsPlanAsIdentity(): void {
  const snap = snapshot();
  const exported = buildMappingSheetRows(snap);
  const result = parseMappingSheet(mappingSheetToBuffer(exported));
  assert(result.ok, `the export parses: ${result.ok ? "" : JSON.stringify(result.error)}`);
  if (!result.ok) {
    return;
  }
  assert(result.errors.length === 0, `the export has no parse-level errors: ${JSON.stringify(result.errors)}`);
  assert(result.rows.length === exported.length - 1, "every exported data row parsed");

  const p = planMappingSheet(result.rows, snap);
  const existingNonComputedOnActiveAssets = existing.filter((r) => r.sourceKind !== "computed" && r.assetId !== "a3").length;
  const preFillRows = 3; // a1: pressure; a2: kwh, pressure
  assert(p.creates.length === 0, `identity: creates 0, got ${summary(p)}`);
  assert(p.updates.length === 0, `identity: updates 0, got ${summary(p)}`);
  assert(p.errors.length === 0, `identity: errors 0, got ${summary(p)}`);
  assert(p.unchanged === existingNonComputedOnActiveAssets, `identity: unchanged = ${existingNonComputedOnActiveAssets}, got ${summary(p)}`);
  assert(p.untouchedSuggestions === preFillRows, `identity: untouchedSuggestions = ${preFillRows}, got ${summary(p)}`);
  assert(existingNonComputedOnActiveAssets > 0 && preFillRows > 0, "the identity is asserted over a non-empty set of each");
  assert(p.previewCreates.length === 0 && p.previewUpdates.length === 0, "the preview DTO lists are empty too");
}

/** A changed source key is one update with one field-level change, and the write carries the new key. */
export function assertChangedSourceKeyIsOneUpdate(): void {
  const p = plan([row({ source_data_key: "TX01_KW_2" })]);
  const changes = onlyUpdate(p, "changed key");
  assert(
    JSON.stringify(changes) === JSON.stringify([{ field: "sourceDataKey", from: "TX01_KW", to: "TX01_KW_2" }]),
    `one change on sourceDataKey, got ${JSON.stringify(changes)}`,
  );
  const update = p.updates[0];
  assert(update?.assetPointId === pointId(1) && update.row === 2 && update.assetCode === "TX01" && update.pointKey === "kw", "the update names the row");
  assert(update?.write.sourceDataKey === "TX01_KW_2" && update.write.sourceKind === "measured" && update.write.rtuId === R1, "the write is the full next state");
  assert(update?.write.active === true && update.write.unit === null, "unchanged columns are carried as stored");
}

/** Design decision 5: a blank `rtu_code` keeps a `manual` row manual and turns a `measured` row `unmapped`. */
export function assertBlankRtuCodeFollowsTheSourceKindRule(): void {
  const manual = plan([row({ point_key: "kw_manual", rtu_code: "", source_data_key: "MANUAL_KW", unit: "kW" })]);
  assert(manual.unchanged === 1 && manual.updates.length === 0 && manual.errors.length === 0, `a manual row with a blank rtu_code is unchanged, got ${summary(manual)}`);

  const measured = plan([row({ rtu_code: "" })]);
  const changes = onlyUpdate(measured, "unwire a measured row");
  assert(JSON.stringify(changes) === JSON.stringify([{ field: "rtuCode", from: "WC-RTU-1", to: null }]), `one change on rtuCode, got ${JSON.stringify(changes)}`);
  const write = measured.updates[0]?.write;
  assert(write?.rtuId === null && write.sourceKind === "unmapped", `the write plans rtu_id NULL and source_kind unmapped, got ${JSON.stringify(write)}`);

  const rewired = plan([row({ point_key: "kw", rtu_code: "WC-RTU-2" })]);
  const rewiredChanges = onlyUpdate(rewired, "re-wire to another RTU");
  assert(JSON.stringify(rewiredChanges) === JSON.stringify([{ field: "rtuCode", from: "WC-RTU-1", to: "WC-RTU-2" }]), "a different code is a change");
  assert(rewired.updates[0]?.write.rtuId === R2 && rewired.updates[0].write.sourceKind === "measured", "the write names the new RTU");

  const wiredManual = plan([row({ point_key: "kw_manual", rtu_code: "WC-RTU-1", source_data_key: "MANUAL_KW", unit: "kW" })]);
  assert(wiredManual.updates[0]?.write.sourceKind === "measured" && wiredManual.updates[0].write.rtuId === R1, "a non-blank rtu_code on a manual row makes it measured");

  const unmappedStays = plan([row({ asset_code: "TX02", asset_name: "Transformer 2", rtu_code: "", source_data_key: "TX02_KW" })]);
  assert(unmappedStays.unchanged === 1, `an unmapped row with a blank rtu_code is unchanged, got ${summary(unmappedStays)}`);
}

/** `active` FALSE on an existing row is one update on `active`; blank keeps the stored state; the five and unit diff too. */
export function assertActiveAndMetadataDiffs(): void {
  const deactivate = plan([row({ active: "FALSE" })]);
  const changes = onlyUpdate(deactivate, "deactivate");
  assert(JSON.stringify(changes) === JSON.stringify([{ field: "active", from: true, to: false }]), `one change on active, got ${JSON.stringify(changes)}`);
  assert(deactivate.updates[0]?.write.active === false, "the write deactivates");

  const blankActive = plan([row({ active: "" })]);
  assert(blankActive.unchanged === 1 && blankActive.updates.length === 0, `a blank active on an existing row is no change, got ${summary(blankActive)}`);

  const reactivate = plan([row({ asset_code: "NOTPL", asset_name: "No template", source_data_key: "NOTPL_KW", active: "TRUE" })]);
  assert(JSON.stringify(onlyUpdate(reactivate, "reactivate")) === JSON.stringify([{ field: "active", from: false, to: true }]), "TRUE on an inactive row re-activates it");

  const metadata = plan([row({ eng_max: 100, quality_policy: "accept_bad", scale_multiplier: "0.1" })]);
  const metaChanges = onlyUpdate(metadata, "set three of the five");
  assert(
    JSON.stringify(metaChanges) ===
      JSON.stringify([
        { field: "scaleMultiplier", from: null, to: 0.1 },
        { field: "engMax", from: null, to: 100 },
        { field: "qualityPolicy", from: null, to: "accept_bad" },
      ]),
    `three changes in field order, got ${JSON.stringify(metaChanges)}`,
  );
  const write = metadata.updates[0]?.write;
  assert(write?.metadata.engMax === 100 && write.metadata.scaleMultiplier === 0.1 && write.metadata.qualityPolicy === "accept_bad" && write.metadata.engMin === null, "the write carries the five as parsed");

  const clearUnit = plan([row({ point_key: "kwh", source_data_key: "TX01_KWH", unit: "" })]);
  assert(JSON.stringify(onlyUpdate(clearUnit, "clear unit")) === JSON.stringify([{ field: "unit", from: "kWh", to: null }]), "a blank unit on an update is an explicit clear to null");
  assert(clearUnit.updates[0]?.write.unit === null, "the write clears the unit");

  const setUnit = plan([row({ unit: "MW" })]);
  assert(JSON.stringify(onlyUpdate(setUnit, "set unit")) === JSON.stringify([{ field: "unit", from: null, to: "MW" }]), "a typed unit on an update is a change");
}

/** `active` TRUE on a pre-fill row creates it, with `template.unit ?? catalog.unit` when the unit cell is blank. */
export function assertTrueOnAPreFillRowCreates(): void {
  const p = plan([row({ asset_code: "TX02", asset_name: "Transformer 2", point_key: "kwh", rtu_code: "WC-RTU-2", source_data_key: "TX02_KWH", unit: "", active: "TRUE" })]);
  assert(p.creates.length === 1 && p.updates.length === 0 && p.errors.length === 0, `one create, got ${summary(p)}`);
  const create = p.creates[0];
  assert(create?.assetId === "a2" && create.assetCode === "TX02" && create.pointKey === "kwh" && create.row === 2, "the create names the row");
  assert(create?.unit === "kWh", `the template unit fills a blank unit cell, got ${create?.unit}`);
  assert(create?.rtuId === R2 && create.sourceKind === "measured" && create.sourceDataKey === "TX02_KWH" && create.active === true, "the write is wired");
  assert(JSON.stringify(create?.metadata) === JSON.stringify(FIVE_NULL), "blank metadata cells create as null (inherit)");
  const preview = p.previewCreates[0];
  assert(mappingSheetCreateDtoSchema.safeParse(preview).success, `the preview create parses against its DTO, got ${JSON.stringify(preview)}`);
  assert(preview?.rtuCode === "WC-RTU-2" && preview.unit === "kWh" && preview.active === true, "the preview carries the resolved values");

  const catalogUnit = plan([row({ asset_code: "NOTPL", asset_name: "No template", point_key: "temp", rtu_code: "", source_data_key: "NOTPL_T", unit: "", active: "TRUE" })]);
  assert(catalogUnit.creates[0]?.unit === "degC", `an asset with no template falls back to the catalog unit, got ${catalogUnit.creates[0]?.unit}`);
  assert(catalogUnit.creates[0]?.sourceKind === "unmapped" && catalogUnit.creates[0].rtuId === null, "a blank rtu_code creates an unmapped row");

  const typedUnit = plan([row({ asset_code: "TX02", asset_name: "Transformer 2", point_key: "kwh", rtu_code: "", source_data_key: "TX02_KWH", unit: "MWh", active: "TRUE" })]);
  assert(typedUnit.creates[0]?.unit === "MWh", "a typed unit wins over the template's");

  const templateOnlyKey = plan([row({ point_key: "pressure", source_data_key: "TX01_P", active: "TRUE" })]);
  assert(templateOnlyKey.creates.length === 1 && templateOnlyKey.creates[0]?.unit === "bar", `a key the template declares but the catalog lacks is created with the template unit, got ${summary(templateOnlyKey)}`);

  const declined = plan([row({ asset_code: "TX02", asset_name: "Transformer 2", point_key: "kwh", source_data_key: "TX02_KWH", active: "FALSE" })]);
  assert(declined.creates.length === 1 && declined.creates[0]?.active === false, `FALSE on a pre-fill row creates an inactive mapping, got ${summary(declined)}`);
}

/** A blank `active` on a row with no existing mapping is an untouched suggestion — nothing written, nothing reported, even with bad cells after it. */
export function assertBlankActiveOnANewRowIsUntouched(): void {
  const p = plan([row({ asset_code: "TX02", asset_name: "Transformer 2", point_key: "kwh", source_data_key: "TX02_KWH", active: "" })]);
  assert(p.untouchedSuggestions === 1 && p.creates.length === 0 && p.errors.length === 0, `an untouched suggestion, got ${summary(p)}`);

  const withGarbage = plan([row({ asset_code: "TX02", asset_name: "Transformer 2", point_key: "kwh", source_data_key: "", scale_multiplier: "abc", active: "" })]);
  assert(withGarbage.untouchedSuggestions === 1 && withGarbage.errors.length === 0, `step 7 stops before steps 10-12, got ${summary(withGarbage)}`);
}

/** Steps 5, 6, 8, 9: asset and key resolution, one code per row, in order. */
export function assertResolutionErrors(): void {
  assert(onlyError(plan([row({ asset_code: "OLD1", asset_name: "Retired", source_data_key: "OLD1_KW" })]), "asset_inactive", "asset_code", "inactive asset").includes("OLD1"), "the message names the asset");
  assert(onlyError(plan([row({ asset_code: "ELSEWHERE" })]), "asset_not_found", "asset_code", "a code of another location").includes("ELSEWHERE"), "the message names the code");
  onlyError(plan([row({ asset_code: "OLD1", asset_name: "Retired", scale_multiplier: "abc", rtu_code: "NOPE" })]), "asset_inactive", "asset_code", "step 5 precedes 9 and 12");
  onlyError(plan([row({ asset_code: "ELSEWHERE", point_key: "nonsense", scale_multiplier: "abc" })]), "asset_not_found", "asset_code", "step 5 precedes 8 and 12");

  onlyError(plan([row({ point_key: "pf", rtu_code: "", source_data_key: "TX01_PF" })]), "point_key_computed", "point_key", "an existing computed row");
  onlyError(plan([row({ asset_code: "TX02", asset_name: "Transformer 2", point_key: "pf", rtu_code: "", source_data_key: "TX02_PF" })]), "point_key_computed", "point_key", "a template-derived key with no row");
  onlyError(plan([row({ asset_code: "TX02", asset_name: "Transformer 2", point_key: "pf", rtu_code: "", source_data_key: "TX02_PF", active: "" })]), "point_key_computed", "point_key", "step 6 precedes step 7");

  onlyError(plan([row({ asset_code: "NOTPL", asset_name: "No template", point_key: "nonsense", source_data_key: "X" })]), "point_key_unknown", "point_key", "a key in neither the catalog nor the template");
  onlyError(plan([row({ asset_code: "NOTPL", asset_name: "No template", point_key: "dead", source_data_key: "X" })]), "point_key_unknown", "point_key", "an inactive catalog key");
  onlyError(plan([row({ asset_code: "NOTPL", asset_name: "No template", point_key: "pressure", source_data_key: "X" })]), "point_key_unknown", "point_key", "a key another template declares does not count for an asset with none");

  assert(onlyError(plan([row({ rtu_code: "NOPE" })]), "rtu_not_found", "rtu_code", "an unknown RTU code").includes("NOPE"), "the message names the code");
  onlyError(plan([row({ rtu_code: "NOPE", source_data_key: "", scale_multiplier: "abc" })]), "rtu_not_found", "rtu_code", "step 9 precedes 10 and 12");
  onlyError(plan([row({ source_data_key: "", scale_multiplier: "abc" })]), "source_data_key_required", "source_data_key", "the deferred cell error surfaces at step 10");
  onlyError(plan([row({ scale_multiplier: "abc" })]), "number_invalid", "scale_multiplier", "the deferred cell error surfaces at step 12");
}

/** Step 13, the merged pair: a sheet `eng_min` beside the template's `eng_max` that inverts the band, message naming the inherited side. */
export function assertMergedPairIsRefusedNamingTheInheritedSide(): void {
  const p = plan([row({ point_key: "kwh", source_data_key: "TX01_KWH", unit: "kWh", eng_min: 150 })]);
  const message = onlyError(p, "eng_range_inverted", "eng_min", "eng_min 150 beside template eng_max 100");
  assert(message.includes("100"), `the message names the inherited value, got "${message}"`);
  assert(message.includes("(inherited from the template)"), `the message marks the inherited side, got "${message}"`);
  assert(message.includes("150"), `the message names the sheet's value, got "${message}"`);

  const bothInSheet = plan([row({ eng_min: 100, eng_max: 0 })]);
  const bothMessage = onlyError(bothInSheet, "eng_range_inverted", "eng_min", "both bounds in the sheet, inverted");
  assert(!bothMessage.includes("inherited"), `neither side is inherited, got "${bothMessage}"`);

  const overrideBoth = plan([row({ point_key: "kwh", source_data_key: "TX01_KWH", unit: "kWh", eng_min: 150, eng_max: 200 })]);
  assert(overrideBoth.updates.length === 1 && overrideBoth.errors.length === 0, `restating both bounds in the sheet ignores the template's, got ${summary(overrideBoth)}`);

  const create = plan([row({ asset_code: "TX02", asset_name: "Transformer 2", point_key: "pressure", rtu_code: "", source_data_key: "TX02_P", eng_min: 10, active: "TRUE" })]);
  onlyError(create, "eng_range_inverted", "eng_min", "a create's eng_min at the template's eng_max");

  const noTemplate = plan([row({ asset_code: "NOTPL", asset_name: "No template", source_data_key: "NOTPL_KW", eng_min: 5 })]);
  assert(noTemplate.updates.length === 1 && noTemplate.errors.length === 0, `an asset with no template has nothing to inherit, got ${summary(noTemplate)}`);
}

/** Step 14: the same source key twice on one asset in the sheet, or held by an existing row of another key the sheet does not change. */
export function assertSourceKeyDuplicates(): void {
  const inSheet = plan([row({ source_data_key: "SAME" }), row({ point_key: "kw_manual", rtu_code: "", source_data_key: "SAME", unit: "kW" })]);
  assert(inSheet.errors.length === 1 && inSheet.updates.length === 1, `the later row is refused, the first proceeds, got ${summary(inSheet)}`);
  const inSheetError = inSheet.errors[0];
  assert(inSheetError?.code === "source_data_key_duplicate" && inSheetError.column === "source_data_key" && inSheetError.row === 3, `row 3 → source_data_key_duplicate, got ${JSON.stringify(inSheetError)}`);
  assert(inSheetError?.message.includes("row 2"), `the message names the first row, got "${inSheetError?.message}"`);

  const acrossAssets = plan([row({ source_data_key: "SAME" }), row({ asset_code: "TX02", asset_name: "Transformer 2", rtu_code: "", source_data_key: "SAME" })]);
  assert(acrossAssets.errors.length === 0 && acrossAssets.updates.length === 2, `the same key on two assets is not a duplicate, got ${summary(acrossAssets)}`);

  const againstExisting = plan([row({ point_key: "kwh", source_data_key: "TX01_KW", unit: "kWh" })]);
  const againstMessage = onlyError(againstExisting, "source_data_key_duplicate", "source_data_key", "a key an existing row of another point holds");
  assert(againstMessage.includes("kw"), `the message names the existing point key, got "${againstMessage}"`);

  const released = plan([row({ point_key: "kwh", source_data_key: "TX01_KW", unit: "kWh" }), row({ source_data_key: "TX01_KW_2" })]);
  assert(released.errors.length === 0 && released.updates.length === 2, `a key the sheet moves off its existing row is free, got ${summary(released)}`);

  const notReleased = plan([row({ point_key: "kwh", source_data_key: "TX01_KW", unit: "kWh" }), row({ source_data_key: "TX01_KW_2", rtu_code: "NOPE" })]);
  assert(notReleased.errors.length === 2, `a row refused earlier releases nothing, got ${summary(notReleased)}`);
  assert(notReleased.errors.map((e) => e.code).includes("source_data_key_duplicate") && notReleased.errors.map((e) => e.code).includes("rtu_not_found"), `both codes, got ${summary(notReleased)}`);

  const cascade = plan([
    row({ point_key: "kwh", source_data_key: "TX01_KW", unit: "kWh" }),
    row({ source_data_key: "MANUAL_KW" }),
  ]);
  assert(cascade.errors.length === 2 && cascade.errors.every((e) => e.code === "source_data_key_duplicate"), `kw cannot take MANUAL_KW, so it does not release TX01_KW, so kwh cannot take it either, got ${summary(cascade)}`);

  const untouchedClaimsNothing = plan([
    row({ asset_code: "TX02", asset_name: "Transformer 2", point_key: "kwh", source_data_key: "TX02_X", active: "" }),
    row({ asset_code: "TX02", asset_name: "Transformer 2", point_key: "pressure", rtu_code: "", source_data_key: "TX02_X", active: "TRUE" }),
  ]);
  assert(untouchedClaimsNothing.errors.length === 0 && untouchedClaimsNothing.creates.length === 1 && untouchedClaimsNothing.untouchedSuggestions === 1, `an untouched suggestion claims no key, got ${summary(untouchedClaimsNothing)}`);

  const ownKey = plan([row({ point_key: "kw", source_data_key: "TX01_KW", eng_max: 5 })]);
  assert(ownKey.updates.length === 1 && ownKey.errors.length === 0, `a row keeping its own key is not a duplicate of itself, got ${summary(ownKey)}`);
}

/** Design decision 6: a changed `asset_name` is neither an update nor an error. Counts add up; errors are in row order. */
export function assertAssetNameIsInformationalAndCountsAddUp(): void {
  const renamed = plan([row({ asset_name: "Renamed" })]);
  assert(renamed.unchanged === 1 && renamed.updates.length === 0 && renamed.errors.length === 0, `asset_name is informational, got ${summary(renamed)}`);

  const mixed = plan([
    row({ asset_code: "ELSEWHERE" }),
    row({ point_key: "kw_manual", rtu_code: "", source_data_key: "MANUAL_KW", unit: "kW" }),
    row({ source_data_key: "TX01_KW_2" }),
    row({ asset_code: "TX02", asset_name: "Transformer 2", point_key: "kwh", source_data_key: "TX02_KWH", active: "" }),
    row({ asset_code: "TX02", asset_name: "Transformer 2", point_key: "pressure", rtu_code: "", source_data_key: "TX02_P", active: "TRUE" }),
    row({ point_key: "kwh", source_data_key: "TX01_KWH", unit: "kWh", eng_min: 150 }),
  ]);
  assert(mixed.creates.length === 1 && mixed.updates.length === 1 && mixed.unchanged === 1 && mixed.untouchedSuggestions === 1 && mixed.errors.length === 2, `every row lands in exactly one bucket, got ${summary(mixed)}`);
  assert(JSON.stringify(mixed.errors.map((e) => e.row)) === JSON.stringify([2, 7]), `errors in row order, got ${summary(mixed)}`);
  assert(mixed.previewCreates.length === mixed.creates.length && mixed.previewUpdates.length === mixed.updates.length, "the preview lists mirror the write lists");
  assert(mixed.updates[0]?.row === 4 && mixed.creates[0]?.row === 6, "creates and updates carry their rows");
}
