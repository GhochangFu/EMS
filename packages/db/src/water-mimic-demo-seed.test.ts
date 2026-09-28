import { describe, it } from "vitest";

import {
  assertRoleMapKeysEqualTheFiveDemoAssetCodes,
  assertRoleMapValuesArePresetRoleCodes,
  assertTheResizeMatchesOnlyTheSeededShape,
  assertTheResizeSetsTenRows,
  assertTheSeedResizesItsOwnDashboardsWidget,
  assertTheWidgetConfigParsesUnderMimicConfigSchema,
} from "./water-mimic-demo-seed.spec";

describe("F3.32 v1 — the demo water plant mimic seed's role map", () => {
  it("keys equal the five demo asset codes", () => {
    assertRoleMapKeysEqualTheFiveDemoAssetCodes();
  });

  it("values are preset role codes", () => {
    assertRoleMapValuesArePresetRoleCodes();
  });

  it("the widget config parses under mimicConfigSchema", () => {
    assertTheWidgetConfigParsesUnderMimicConfigSchema();
  });
});

describe("F3.32b — a mimic widget an earlier seed wrote 12 x 6 becomes 10 tall", () => {
  it("the resize sets grid_h 10", () => {
    assertTheResizeSetsTenRows();
  });

  it("the resize matches only the seeded row at its old shape", () => {
    assertTheResizeMatchesOnlyTheSeededShape();
  });

  it("seedWaterMimicDemo resizes its own dashboard's widget", async () => {
    await assertTheSeedResizesItsOwnDashboardsWidget();
  });
});
