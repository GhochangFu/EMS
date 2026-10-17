import { putMimicLayoutBodySchema } from "@bms/shared";
import { expect } from "vitest";

import { CONTROL_ROOM_SITE_NAME, eskomSeedAssetCatalog } from "./eskom-assets-seed";
import { NETWORK_DEMO_ASSETS, NETWORK_DEMO_NETWORKS, NETWORK_DEMO_UNIT_BOX } from "./network-demo-seed";
import { DEMO_WATER_PLANT_ASSETS } from "./water-plant-demo-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/** The fifteen codes the plan's Task 3.1 names (F3.80 OQ1 (a)). */
const EXPECTED_CODES: readonly string[] = [
  "ND-HT-GRID-CB",
  "ND-HT-COUPLER",
  "ND-DG-1",
  "ND-HT-DG-CB",
  "ND-HT-OUT-CB",
  "ND-TR-A",
  "ND-LT-A",
  "ND-LT-A-F1",
  "ND-LT-A-F2",
  "ND-HT-ISO-B",
  "ND-LT-B-F1",
  "ND-FL-PUMP",
  "ND-FL-ISO-V1",
  "ND-FL-CV",
  "ND-FL-DAMPER",
];

/** The fifteen codes are unique, start with `ND-`, and are exactly {@link EXPECTED_CODES}. */
export function assertEveryCodeIsUniqueAndStartsWithNw(): void {
  const codes = NETWORK_DEMO_ASSETS.map((a) => a.code);
  expect(codes).toHaveLength(15);
  expect(new Set(codes).size).toBe(codes.length);
  expect([...codes].sort()).toEqual([...EXPECTED_CODES].sort());
  expect(codes.filter((c) => !c.startsWith("ND-"))).toEqual([]);
}

/** Every demo asset sits at `CONTROL_ROOM_SITE_NAME` (RSMOC-WC, owner ruling OQ3 (a)). */
export function assertEveryCodeSitsAtTheControlRoomSite(): void {
  expect(NETWORK_DEMO_ASSETS.length).toBeGreaterThan(0);
  expect(NETWORK_DEMO_ASSETS.filter((a) => a.siteName !== CONTROL_ROOM_SITE_NAME)).toEqual([]);
}

/** The flow units are water and HVAC; the other eleven are electrical. */
export function assertTheDomainsAreElectricalWaterAndHvac(): void {
  const byCode = new Map(NETWORK_DEMO_ASSETS.map((a) => [a.code, a.domain]));
  expect(byCode.get("ND-FL-PUMP")).toBe("water");
  expect(byCode.get("ND-FL-ISO-V1")).toBe("water");
  expect(byCode.get("ND-FL-CV")).toBe("water");
  expect(byCode.get("ND-FL-DAMPER")).toBe("hvac");
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

/**
 * `F4.263` — every layout the seed writes, rebuilt as the `PUT /mimic-layouts/:id` body the editor
 * and a copilot `mimicLayout.replace` card send, parses with that body's own schema. A seeded key
 * the key rule refuses (`grid-cb`) would make the layout unsavable.
 */
export function assertEveryLayoutBodyParsesAsAPutBody(): void {
  expect(NETWORK_DEMO_NETWORKS).toHaveLength(2);
  for (const network of NETWORK_DEMO_NETWORKS) {
    const body = {
      version: 1,
      name: network.name,
      slug: network.slug,
      canvasW: network.canvasW,
      canvasH: network.canvasH,
      symbolLibraries: [...network.symbolLibraries],
      nodes: network.nodes.map(([key, symbol, label, roleCode, isSource, isSwitching, fanOut, x, y]) => ({
        key,
        kind: "unit",
        symbol,
        label,
        ...(roleCode ? { roleCode } : {}),
        x,
        y,
        w: NETWORK_DEMO_UNIT_BOX.w,
        h: NETWORK_DEMO_UNIT_BOX.h,
        z: NETWORK_DEMO_UNIT_BOX.z,
        ...(fanOut ? { fanOut: true } : {}),
        ...(isSource ? { isSource: true } : {}),
        ...(isSwitching ? { isSwitching: true } : {}),
      })),
      pipes: network.pipes.map(([fromKey, toKey]) => ({ fromKey, toKey })),
    };
    const result = putMimicLayoutBodySchema.safeParse(body);
    expect(result.success, `${network.slug}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
  }
}
