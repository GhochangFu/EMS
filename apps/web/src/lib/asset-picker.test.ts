import { describe, it } from "vitest";

import { runFilterAssetsByQueryTests, runToggleAssetSelectionTests } from "./asset-picker.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("asset-picker", () => {
  it("filters the candidate list by code, name, or site name", () => {
    runFilterAssetsByQueryTests();
  });

  it("toggles an asset id in and out of the selected set", () => {
    runToggleAssetSelectionTests();
  });
});
