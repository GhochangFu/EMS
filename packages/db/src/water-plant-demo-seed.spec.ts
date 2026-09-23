import { CALC_DIALECT_V3 } from "@bms/shared";
import { expect } from "vitest";

import {
  DEMO_WATER_CALC_INTERVAL_SECONDS,
  DEMO_WATER_CLASSES,
  DEMO_WATER_TEMPLATE_POINTS_SQL,
  type DemoWaterClass,
  demoWaterTemplatePointsParams,
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

/** The params carry the eleven positions the SQL binds, `$1` through `$11`. */
export function assertTheParamsBindElevenPositions(): void {
  for (const c of DEMO_WATER_CLASSES) {
    expect(demoWaterTemplatePointsParams(ORGANIZATION_ID, c).length, c.assetCode).toBe(11);
  }
  expect(DEMO_WATER_TEMPLATE_POINTS_SQL).toContain("$11::text[]");
  expect(DEMO_WATER_TEMPLATE_POINTS_SQL).not.toMatch(/\$12\b/);
}

/** The SQL's column list names the arrays in the order the params build them. */
export function assertTheUnnestColumnsFollowTheParamsOrder(): void {
  const sql = DEMO_WATER_TEMPLATE_POINTS_SQL.replace(/\s+/g, " ");
  expect(sql).toContain(
    "unnest($4::varchar[], $5::varchar[], $6::varchar[], $7::varchar[], $8::boolean[], $9::int[], $10::varchar[], $11::text[])",
  );
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

/** A measured flow row carries no formula, and the stock row's `meta.tier`. */
export function assertMeasuredRowsCarryNoFormulaAndTheirTier(): void {
  for (const c of DEMO_WATER_CLASSES) {
    for (const row of measuredRowsOf(c)) {
      const flow = c.flowRows.find((f) => f.pointKey === row.point_key)!;
      expect(row.formula, `${c.assetCode} ${String(row.point_key)} formula`).toBeNull();
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

/** A derived volume row carries its own formula, non-null, and no tier. */
export function assertDerivedRowsCarryTheirFormula(): void {
  for (const c of DEMO_WATER_CLASSES) {
    for (const row of derivedRowsOf(c)) {
      const volume = c.derivedRows.find((d) => d.pointKey === row.point_key)!;
      expect(row.formula, `${c.assetCode} ${String(row.point_key)} formula`).toBe(volume.formula);
      expect(row.formula, `${c.assetCode} ${String(row.point_key)} formula`).not.toBeNull();
      expect(row.tier, `${c.assetCode} ${String(row.point_key)} tier`).toBeNull();
    }
  }
}

/**
 * The dialect is `CALC_DIALECT_V3`, bound as `$3`, and only a derived row gets
 * it: the CASE has no ELSE, so a measured row's dialect is NULL.
 */
export function assertDerivedRowsGetDialectV3AndMeasuredRowsNone(): void {
  for (const c of DEMO_WATER_CLASSES) {
    expect(demoWaterTemplatePointsParams(ORGANIZATION_ID, c)[2], c.assetCode).toBe(CALC_DIALECT_V3);
  }
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
