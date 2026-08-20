import { describe, it } from "vitest";

import { runIsAssetLevelReadyTests } from "./hierarchy-filter.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("hierarchy-filter", () => {
  it("gates the asset level on rtuId only when rtu is a requested level", () => {
    runIsAssetLevelReadyTests();
  });
});
