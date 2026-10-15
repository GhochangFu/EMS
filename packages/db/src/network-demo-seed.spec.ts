import { expect } from "vitest";

import { CONTROL_ROOM_SITE_NAME, eskomSeedAssetCatalog } from "./eskom-assets-seed";
import { NETWORK_DEMO_ASSETS } from "./network-demo-seed";
import { DEMO_WATER_PLANT_ASSETS } from "./water-plant-demo-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/** The fifteen codes the plan's Task 3.1 names (F3.80 OQ1 (a)). */
const EXPECTED_CODES: readonly string[] = [
  "NW-HT-GRID-CB",
  "NW-HT-COUPLER",
  "NW-DG-1",
  "NW-HT-DG-CB",
  "NW-HT-OUT-CB",
  "NW-TR-A",
  "NW-LT-A",
  "NW-LT-A-F1",
  "NW-LT-A-F2",
  "NW-HT-ISO-B",
  "NW-LT-B-F1",
  "NW-FL-PUMP",
  "NW-FL-ISO-V1",
  "NW-FL-CV",
  "NW-FL-DAMPER",
];

/** The fifteen codes are unique, start with `NW-`, and are exactly {@link EXPECTED_CODES}. */
export function assertEveryCodeIsUniqueAndStartsWithNw(): void {
  const codes = NETWORK_DEMO_ASSETS.map((a) => a.code);
  expect(codes).toHaveLength(15);
  expect(new Set(codes).size).toBe(codes.length);
  expect([...codes].sort()).toEqual([...EXPECTED_CODES].sort());
  expect(codes.filter((c) => !c.startsWith("NW-"))).toEqual([]);
}

/** Every demo asset sits at `CONTROL_ROOM_SITE_NAME` (RSMOC-WC, owner ruling OQ3 (a)). */
export function assertEveryCodeSitsAtTheControlRoomSite(): void {
  expect(NETWORK_DEMO_ASSETS.length).toBeGreaterThan(0);
  expect(NETWORK_DEMO_ASSETS.filter((a) => a.siteName !== CONTROL_ROOM_SITE_NAME)).toEqual([]);
}

/** The flow units are water and HVAC; the other eleven are electrical. */
export function assertTheDomainsAreElectricalWaterAndHvac(): void {
  const byCode = new Map(NETWORK_DEMO_ASSETS.map((a) => [a.code, a.domain]));
  expect(byCode.get("NW-FL-PUMP")).toBe("water");
  expect(byCode.get("NW-FL-ISO-V1")).toBe("water");
  expect(byCode.get("NW-FL-CV")).toBe("water");
  expect(byCode.get("NW-FL-DAMPER")).toBe("hvac");
  const electrical = NETWORK_DEMO_ASSETS.filter((a) => a.domain === "electrical");
  expect(electrical).toHaveLength(11);
}

/** The ESKOM catalog ends with the network demo, right after the water plant. */
export function assertTheCatalogCarriesThemAfterTheWaterPlant(): void {
  const catalog = eskomSeedAssetCatalog().map((a) => a.code);
  const lastWater = catalog.indexOf(DEMO_WATER_PLANT_ASSETS[DEMO_WATER_PLANT_ASSETS.length - 1].code);
  expect(lastWater).toBeGreaterThan(-1);
  expect(catalog.slice(lastWater + 1)).toEqual(NETWORK_DEMO_ASSETS.map((a) => a.code));
}
