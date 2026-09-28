import { mimicConfigSchema } from "@bms/shared";
import { expect } from "vitest";

import { DEMO_WATER_ASSET_CODES } from "./water-plant-demo-seed";
import { DEMO_MIMIC_ROLE_BY_ASSET_CODE, DEMO_MIMIC_WIDGET_CONFIG } from "./water-mimic-demo-seed";

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
