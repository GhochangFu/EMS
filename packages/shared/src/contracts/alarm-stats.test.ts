import { describe, it } from "vitest";

import * as spec from "./alarm-stats.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.291 — the get_alarm_stats contract (ADR 0030)", () => {
  it("parses a full answer", () => spec.assertTheFixtureParses());
  it("refuses a negative count", () => spec.assertANegativeCountIsRefused());
  it("refuses an answer without the mttaSeconds key (null is required, not absent)", () => spec.assertAMissingMttaKeyIsRefused());
  it("refuses a top asset without assetRtuName (F4.316, ADR 0111)", () => spec.assertATopAssetWithoutAssetRtuNameIsRefused());
  it("refuses a top asset without assetLocationName (F4.316, ADR 0111)", () => spec.assertATopAssetWithoutAssetLocationNameIsRefused());
  it("parses a top asset with null RTU and location names (F4.316, ADR 0111)", () => spec.assertATopAssetWithNullPartsParses());
});
