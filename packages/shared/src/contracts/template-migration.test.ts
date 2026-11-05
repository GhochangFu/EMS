import { describe, it } from "vitest";

import {
  aMigrationAssetWithNullNamesParses,
  aMigrationAssetWithoutTheLocationNameIsRefused,
  aMigrationAssetWithoutTheRtuNameIsRefused,
} from "./template-migration.spec";

/** `F4.316` PR 8 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.316 — the migration asset row names its RTU (ADR 0111)", () => {
  it("requires assetRtuName", () => aMigrationAssetWithoutTheRtuNameIsRefused());
  it("requires assetLocationName", () => aMigrationAssetWithoutTheLocationNameIsRefused());
  it("accepts null names", () => aMigrationAssetWithNullNamesParses());
});
