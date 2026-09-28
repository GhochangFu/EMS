import { mimicConfigSchema } from "@bms/shared";
import { expect } from "vitest";

import {
  IONX_ASSET_CODES,
  IONX_EXPECTED,
  IONX_ROLE_BY_ASSET_CODE,
  IONX_WIDGET_CONFIG,
  ionxAssetCodeFor,
  ionxShortfalls,
  type IonxIdentityCounts,
  type IonxTenantCounts,
} from "./demo-ion-exchange";
import { DEMO_WATER_ASSET_CODES } from "./water-plant-demo-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/** `assets_code_unique` is fleet-wide: no IONX code may equal an ESKOM demo code. */
export function assertNoIonxCodeCollidesWithTheEskomDemoPlant(): void {
  const eskom = new Set(DEMO_WATER_ASSET_CODES);
  const clashes = IONX_ASSET_CODES.filter((code) => eskom.has(code));
  expect(clashes).toEqual([]);
}

/** Each code keeps `WTR-<CLASS>-NN`, which `apps/sim`'s `waterClassOf` reads by infix. */
export function assertEachCodeKeepsTheSimulatorWaterShape(): void {
  expect([...IONX_ASSET_CODES]).toEqual(["WTR-WTP-02", "WTR-RO-02", "WTR-CT-02", "WTR-STP-02", "WTR-ETP-02"]);
}

/** A code that does not end in -01 is refused, not silently re-suffixed. */
export function assertIonxAssetCodeForRefusesAnUnexpectedSuffix(): void {
  expect(() => ionxAssetCodeFor("WTR-WTP-07")).toThrow(/does not end in -01/);
}

/** The role map is keyed by exactly the five IONX codes and carries the ruled roles. */
export function assertRoleMapIsTheRuledOne(): void {
  expect({ ...IONX_ROLE_BY_ASSET_CODE }).toEqual({
    "WTR-WTP-02": "wtp",
    "WTR-RO-02": "ro",
    "WTR-CT-02": "utilities",
    "WTR-STP-02": "stp",
    "WTR-ETP-02": "etp",
  });
}

/** The widget config parses under `mimicConfigSchema` (U0). */
export function assertTheWidgetConfigParsesUnderMimicConfigSchema(): void {
  const result = mimicConfigSchema.safeParse(IONX_WIDGET_CONFIG);
  expect(result.success, JSON.stringify(result)).toBe(true);
}

/** The widget config names the water train preset, as ruled. */
export function assertTheWidgetConfigIsTheWaterTrainPreset(): void {
  expect(IONX_WIDGET_CONFIG).toEqual({ source: "preset", preset: "water_train" });
}

const COMPLETE_IDENTITY: IonxIdentityCounts = { users: 1, orgGrants: 1, otherGrants: 0 };

/** A read-back equal to the expectation has no shortfall. */
export function assertAFullReadBackHasNoShortfall(): void {
  expect(ionxShortfalls({ ...IONX_EXPECTED }, COMPLETE_IDENTITY)).toEqual([]);
}

/** One missing roled member is named with its counts. */
export function assertAMissingRoledMemberIsNamed(): void {
  const tenant: IonxTenantCounts = { ...IONX_EXPECTED, roledMembers: 4 };
  expect(ionxShortfalls(tenant, COMPLETE_IDENTITY)).toEqual(["roledMembers: 4 of 5"]);
}

/** A grant beyond the one organization is a shortfall — the login must see IONX-DEMO only. */
export function assertAnExtraGrantIsAShortfall(): void {
  expect(ionxShortfalls({ ...IONX_EXPECTED }, { ...COMPLETE_IDENTITY, otherGrants: 1 })).toEqual([
    "otherGrants: 1 of 0",
  ]);
}
