import { describe, it } from "vitest";

import { theRefusedAssetRidesBesideTheRefusal } from "./asset-templates-migrate-calc.spec";

/** `F4.312` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.312 — the calc override gate names the refused asset", () => {
  it("hands the refused asset to refuse beside the refusal", () =>
    theRefusedAssetRidesBesideTheRefusal());
});
