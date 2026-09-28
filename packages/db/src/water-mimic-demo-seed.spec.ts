import { mimicConfigSchema } from "@bms/shared";
import { expect } from "vitest";

import { DEMO_WATER_ASSET_CODES } from "./water-plant-demo-seed";
import type pg from "pg";

import {
  DEMO_MIMIC_ROLE_BY_ASSET_CODE,
  DEMO_MIMIC_WIDGET_CONFIG,
  DEMO_MIMIC_WIDGET_RESIZE_SQL,
  seedWaterMimicDemo,
} from "./water-mimic-demo-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * The role map's keys must equal `DEMO_WATER_ASSET_CODES` exactly, both
 * directions — mutation: drop `WTR-CT-01` from either list and this fails.
 */
export function assertRoleMapKeysEqualTheFiveDemoAssetCodes(): void {
  const keys = Object.keys(DEMO_MIMIC_ROLE_BY_ASSET_CODE).slice().sort();
  const codes = [...DEMO_WATER_ASSET_CODES].slice().sort();
  expect(keys).toEqual(codes);
}

/** Every role value is one of the seven `water_train` preset role codes, or `utilities`. */
export function assertRoleMapValuesArePresetRoleCodes(): void {
  const knownPresetRoleCodes = new Set([
    "water_intake",
    "wtp",
    "ro",
    "softener",
    "water_storage",
    "utilities",
    "stp",
    "etp",
  ]);
  for (const [assetCode, roleCode] of Object.entries(DEMO_MIMIC_ROLE_BY_ASSET_CODE)) {
    expect(knownPresetRoleCodes.has(roleCode), `${assetCode} -> '${roleCode}' must be a preset role code`).toBe(
      true,
    );
  }
}

/** The widget config this module seeds must parse under `mimicConfigSchema` (U0). */
export function assertTheWidgetConfigParsesUnderMimicConfigSchema(): void {
  const result = mimicConfigSchema.safeParse(DEMO_MIMIC_WIDGET_CONFIG);
  expect(
    result.success,
    `DEMO_MIMIC_WIDGET_CONFIG must parse under mimicConfigSchema: ${JSON.stringify(result)}`,
  ).toBe(true);
}

/** `DEMO_MIMIC_WIDGET_RESIZE_SQL`'s `WHERE`, whitespace-collapsed. */
function resizeWhere(): string {
  const sql = DEMO_MIMIC_WIDGET_RESIZE_SQL.replace(/\s+/g, " ").trim();
  return sql.slice(sql.indexOf(" WHERE ") + 1);
}

/** `F3.32b` — the resize sets the seeded mimic widget 10 tall. */
export function assertTheResizeSetsTenRows(): void {
  expect(DEMO_MIMIC_WIDGET_RESIZE_SQL.replace(/\s+/g, " ")).toContain("SET grid_h = 10");
}

/**
 * `F3.32b` — the resize touches only the seeded row: this organization's named dashboard, its
 * mimic widget, at exactly the 12 × 6 shape at (0, 0) an earlier seed wrote. An operator's other
 * size never matches.
 */
export function assertTheResizeMatchesOnlyTheSeededShape(): void {
  expect(resizeWhere()).toBe(
    "WHERE organization_id = $1 AND dashboard_id = $2 AND widget_type = 'mimic' " +
      "AND grid_x = 0 AND grid_y = 0 AND grid_w = 12 AND grid_h = 6",
  );
}

/** A seed pool that records every statement; every `id` read answers by the table it names. */
export function recordingSeedPool(ids: { organization?: string; dashboard: string; other: string }): {
  pool: pg.Pool;
  calls: { sql: string; values: unknown[] }[];
} {
  const calls: { sql: string; values: unknown[] }[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    const id = sql.includes("FROM bms.dashboards")
      ? ids.dashboard
      : sql.includes("FROM bms.organizations")
        ? (ids.organization ?? ids.other)
        : ids.other;
    const roled = Object.keys(DEMO_MIMIC_ROLE_BY_ASSET_CODE).length;
    return { rows: [{ id, groups: 1, roled, dashboards: 1, widgets: 1 }], rowCount: 0 };
  };
  return { pool: { query, options: { max: 1 } } as unknown as pg.Pool, calls };
}

/** `F3.32b` — `seedWaterMimicDemo` runs the resize once, for its organization and dashboard. */
export async function assertTheSeedResizesItsOwnDashboardsWidget(): Promise<void> {
  const { pool, calls } = recordingSeedPool({ dashboard: "dashboard-id", other: "other-id" });
  await seedWaterMimicDemo(pool, "org-id");
  const resizes = calls.filter((c) => c.sql === DEMO_MIMIC_WIDGET_RESIZE_SQL);
  expect(resizes.map((c) => c.values)).toEqual([["org-id", "dashboard-id"]]);
}
