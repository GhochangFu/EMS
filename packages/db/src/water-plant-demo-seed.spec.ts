import { CALC_DIALECT_V3 } from "@bms/shared";
import { expect } from "vitest";

import {
  DEMO_WATER_CALC_INTERVAL_SECONDS,
  DEMO_WATER_CLASSES,
  DEMO_WATER_TEMPLATE_POINTS_SQL,
  DEMO_WATER_VERIFY_SQL,
  type DemoWaterClass,
  demoWaterTemplatePointsParams,
  demoWaterVerifyParams,
} from "./water-plant-demo-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000000";

/**
 * The eight positional arrays `DEMO_WATER_TEMPLATE_POINTS_SQL` unnests, in
 * the order of its `AS d(...)` column list — `$4` through `$11`, which are
 * params indices 3 through 10.
 */
const COLUMNS = ["point_key", "label", "unit", "kind", "required", "sort_order", "tier", "formula"] as const;
type Column = (typeof COLUMNS)[number];
type Row = Record<Column, unknown>;

/** The params of one class, zipped back into rows by position. */
function rowsOf(c: DemoWaterClass): Row[] {
  const params = demoWaterTemplatePointsParams(ORGANIZATION_ID, c);
  const arrays = COLUMNS.map((_, i) => params[3 + i] as unknown[]);
  return arrays[0]!.map((_, r) => Object.fromEntries(COLUMNS.map((col, i) => [col, arrays[i]![r]])) as Row);
}

/** The measured rows: the class's flow rows, by point key. */
function measuredRowsOf(c: DemoWaterClass): Row[] {
  const keys = new Set(c.flowRows.map((row) => row.pointKey));
  const rows = rowsOf(c).filter((row) => keys.has(row.point_key as string));
  expect(rows.length, `${c.assetCode}: found ${rows.length} measured rows, wanted ${keys.size}`).toBe(keys.size);
  return rows;
}

/** The derived rows: the class's volume rows, by point key. */
function derivedRowsOf(c: DemoWaterClass): Row[] {
  const keys = new Set(c.derivedRows.map((row) => row.pointKey));
  const rows = rowsOf(c).filter((row) => keys.has(row.point_key as string));
  expect(rows.length, `${c.assetCode}: found ${rows.length} derived rows, wanted ${keys.size}`).toBe(keys.size);
  return rows;
}

/**
 * Every positional array carries one entry per template row. `unnest` over
 * arrays of unequal length pads the short ones with NULL rather than raising,
 * so a dropped entry would write a row with a NULL unit or kind.
 */
export function assertEveryPositionalArrayHasTheSameLength(): void {
  for (const c of DEMO_WATER_CLASSES) {
    const params = demoWaterTemplatePointsParams(ORGANIZATION_ID, c);
    const lengths = COLUMNS.map((_, i) => (params[3 + i] as unknown[]).length);
    const want = c.flowRows.length + c.derivedRows.length;
    expect(lengths, `${c.assetCode}: positional array lengths ${lengths.join(", ")}`).toEqual(COLUMNS.map(() => want));
  }
}

/**
 * The first rows the params carry are the class's flow rows, in declaration
 * order, equal in EVERY column to what `flowRows` declares — built here from
 * `flowRows` and the two measured literals, not from the module's own map. A
 * slice by position, not a filter by key, so an extra or a missing row reddens
 * too. (The sweep set `required: false` and `sortOrder: 0` on every measured
 * row and every earlier claim stayed green.)
 */
export function assertTheMeasuredRowsEqualTheFlowRowsInEveryColumn(): void {
  for (const c of DEMO_WATER_CLASSES) {
    const expected: Row[] = c.flowRows.map((flow) => ({
      point_key: flow.pointKey,
      label: flow.label,
      unit: "KL/hr",
      kind: "measured",
      required: flow.required,
      sort_order: flow.sortOrder,
      tier: flow.tier,
      formula: null,
    }));
    expect(rowsOf(c).slice(0, c.flowRows.length), `${c.assetCode}: the measured rows`).toEqual(expected);
  }
}

/**
 * The rows after the flow rows are the class's volume rows, in declaration
 * order, equal in EVERY column to what `derivedRows` declares, and nothing
 * follows them.
 */
export function assertTheDerivedRowsEqualTheVolumeRowsInEveryColumn(): void {
  for (const c of DEMO_WATER_CLASSES) {
    const expected: Row[] = c.derivedRows.map((volume) => ({
      point_key: volume.pointKey,
      label: volume.label,
      unit: "KL",
      kind: "derived",
      required: false,
      sort_order: volume.sortOrder,
      tier: null,
      formula: volume.formula,
    }));
    expect(rowsOf(c).slice(c.flowRows.length), `${c.assetCode}: the derived rows`).toEqual(expected);
  }
}

/** The params carry eleven entries, one per bound position. */
export function assertTheParamsHaveElevenEntries(): void {
  for (const c of DEMO_WATER_CLASSES) {
    expect(demoWaterTemplatePointsParams(ORGANIZATION_ID, c).length, c.assetCode).toBe(11);
  }
}

/** The SQL binds `$11`, the formula array. */
export function assertTheSqlBindsPositionEleven(): void {
  expect(DEMO_WATER_TEMPLATE_POINTS_SQL).toContain("$11::text[]");
}

/** The SQL binds no `$12`. */
export function assertTheSqlBindsNoPositionTwelve(): void {
  expect(DEMO_WATER_TEMPLATE_POINTS_SQL).not.toMatch(/\$12\b/);
}

/** `unnest` takes `$4` through `$11`, in order, with the types the params carry. */
export function assertTheUnnestArraysAreTypedInOrder(): void {
  const sql = DEMO_WATER_TEMPLATE_POINTS_SQL.replace(/\s+/g, " ");
  expect(sql).toContain(
    "unnest($4::varchar[], $5::varchar[], $6::varchar[], $7::varchar[], $8::boolean[], $9::int[], $10::varchar[], $11::text[])",
  );
}

/** The SQL's column list names the arrays in the order the params build them. */
export function assertTheUnnestColumnListFollowsTheParamsOrder(): void {
  const sql = DEMO_WATER_TEMPLATE_POINTS_SQL.replace(/\s+/g, " ");
  expect(sql).toContain(`AS d(${COLUMNS.join(", ")})`);
}

/** A measured flow row is a `KL/hr` reading. */
export function assertMeasuredRowsCarryUnitKlPerHour(): void {
  for (const c of DEMO_WATER_CLASSES) {
    for (const row of measuredRowsOf(c)) {
      expect(row.unit, `${c.assetCode} ${String(row.point_key)} unit`).toBe("KL/hr");
    }
  }
}

/** A measured flow row has kind `measured`. */
export function assertMeasuredRowsAreKindMeasured(): void {
  for (const c of DEMO_WATER_CLASSES) {
    for (const row of measuredRowsOf(c)) {
      expect(row.kind, `${c.assetCode} ${String(row.point_key)} kind`).toBe("measured");
    }
  }
}

/** A measured flow row carries no formula. */
export function assertMeasuredRowsCarryNoFormula(): void {
  for (const c of DEMO_WATER_CLASSES) {
    for (const row of measuredRowsOf(c)) {
      expect(row.formula, `${c.assetCode} ${String(row.point_key)} formula`).toBeNull();
    }
  }
}

/** A measured flow row carries the stock row's `meta.tier`. */
export function assertMeasuredRowsCarryTheirTier(): void {
  for (const c of DEMO_WATER_CLASSES) {
    for (const row of measuredRowsOf(c)) {
      const flow = c.flowRows.find((f) => f.pointKey === row.point_key)!;
      expect(row.tier, `${c.assetCode} ${String(row.point_key)} tier`).toBe(flow.tier);
    }
  }
}

/** A derived volume row is a `KL` total. */
export function assertDerivedRowsCarryUnitKl(): void {
  for (const c of DEMO_WATER_CLASSES) {
    for (const row of derivedRowsOf(c)) {
      expect(row.unit, `${c.assetCode} ${String(row.point_key)} unit`).toBe("KL");
    }
  }
}

/** A derived volume row has kind `derived`. */
export function assertDerivedRowsAreKindDerived(): void {
  for (const c of DEMO_WATER_CLASSES) {
    for (const row of derivedRowsOf(c)) {
      expect(row.kind, `${c.assetCode} ${String(row.point_key)} kind`).toBe("derived");
    }
  }
}

/** A derived volume row carries its own formula. */
export function assertDerivedRowsCarryTheirFormula(): void {
  for (const c of DEMO_WATER_CLASSES) {
    for (const row of derivedRowsOf(c)) {
      const volume = c.derivedRows.find((d) => d.pointKey === row.point_key)!;
      expect(row.formula, `${c.assetCode} ${String(row.point_key)} formula`).toBe(volume.formula);
    }
  }
}

/** A derived volume row's formula is never null. */
export function assertDerivedRowsCarryANonNullFormula(): void {
  for (const c of DEMO_WATER_CLASSES) {
    for (const row of derivedRowsOf(c)) {
      expect(row.formula, `${c.assetCode} ${String(row.point_key)} formula`).not.toBeNull();
    }
  }
}

/** A derived volume row carries no tier. */
export function assertDerivedRowsCarryNoTier(): void {
  for (const c of DEMO_WATER_CLASSES) {
    for (const row of derivedRowsOf(c)) {
      expect(row.tier, `${c.assetCode} ${String(row.point_key)} tier`).toBeNull();
    }
  }
}

/** The dialect param, `$3`, is `CALC_DIALECT_V3`. */
export function assertTheDialectParamIsV3(): void {
  for (const c of DEMO_WATER_CLASSES) {
    expect(demoWaterTemplatePointsParams(ORGANIZATION_ID, c)[2], c.assetCode).toBe(CALC_DIALECT_V3);
  }
}

/** Only a derived row gets the dialect: the CASE has no ELSE, so a measured row's is NULL. */
export function assertOnlyADerivedRowGetsTheDialect(): void {
  expect(DEMO_WATER_TEMPLATE_POINTS_SQL).toContain("CASE WHEN d.kind = 'derived' THEN $3::varchar END");
}

/** Only a derived row is `scheduled`; a measured row's trigger is NULL. */
export function assertDerivedRowsAreScheduledAndMeasuredRowsAreNot(): void {
  expect(DEMO_WATER_TEMPLATE_POINTS_SQL).toContain("CASE WHEN d.kind = 'derived' THEN 'scheduled' END");
}

/** Only a derived row runs every 60 s; a measured row's interval is NULL. */
export function assertDerivedRowsRunEverySixtySecondsAndMeasuredRowsNever(): void {
  expect(DEMO_WATER_CALC_INTERVAL_SECONDS).toBe(60);
  expect(DEMO_WATER_TEMPLATE_POINTS_SQL).toContain("CASE WHEN d.kind = 'derived' THEN 60 END");
}

/**
 * The post-condition's `$2` (asset codes) and `$5` (template codes), zipped by
 * position, are exactly each class's own `(assetCode, templateCode)` pair — the
 * pairs the `pinned` count checks each asset against.
 */
export function assertTheVerifyParamsPairEachAssetWithItsOwnTemplate(): void {
  const params = demoWaterVerifyParams(ORGANIZATION_ID);
  const assetCodes = params[1] as string[];
  const templateCodes = params[4] as string[];
  expect(assetCodes.length, "the post-condition's $2 and $5 differ in length").toBe(templateCodes.length);
  expect(assetCodes.map((code, i) => [code, templateCodes[i]])).toEqual(
    DEMO_WATER_CLASSES.map((c) => [c.assetCode, c.templateCode]),
  );
}

/**
 * The post-condition reads the five template codes exactly, never a `LIKE`
 * prefix: an administrator's own `DEMO-WATER-PILOT` version 1 would add its
 * points to `template_points` and stop the boot, and a prefix match on the pin
 * would count a WTP pinned to `DEMO-WATER-ETP`.
 */
export function assertThePostConditionReadsNoLikePattern(): void {
  expect(DEMO_WATER_VERIFY_SQL).not.toMatch(/\bLIKE\b/i);
}

/** The `pinned` count walks `$2` zipped with `$5`, one `(asset, template)` pair per class. */
export function assertThePinnedCountZipsTheTwoCodeLists(): void {
  const sql = DEMO_WATER_VERIFY_SQL.replace(/\s+/g, " ");
  expect(sql).toContain("unnest($2::varchar[], $5::varchar[]) AS p(asset_code, template_code)");
}

/** The `pinned` count matches the asset AND its pinned template to the same pair. */
export function assertThePinnedCountMatchesTheAssetToItsOwnTemplate(): void {
  const sql = DEMO_WATER_VERIFY_SQL.replace(/\s+/g, " ");
  expect(sql).toContain("AND a.code = p.asset_code AND t.code = p.template_code ) ) AS pinned");
}

/** The `template_points` count reads the five template codes, `$5`, exactly. */
export function assertTheTemplatePointsCountReadsTheFiveCodes(): void {
  const sql = DEMO_WATER_VERIFY_SQL.replace(/\s+/g, " ");
  expect(sql).toContain("AND t.code = ANY($5::varchar[]) AND t.version = 1 ) AS template_points");
}
