import { describe, it } from "vitest";

import {
  assertRoleMapKeysEqualTheFiveDemoAssetCodes,
  assertRoleMapValuesArePresetRoleCodes,
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
