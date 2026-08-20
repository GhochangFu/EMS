import { describe, it } from "vitest";

import {
  runIsAssetLevelReadyTests,
  runResolveEffectiveOrganizationIdTests,
} from "./hierarchy-filter.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("hierarchy-filter", () => {
  it("gates the asset level on rtuId only when rtu is a requested level", () => {
    runIsAssetLevelReadyTests();
  });

  it("resolves a locked org's id even when selection.organizationId is unset", () => {
    runResolveEffectiveOrganizationIdTests();
  });
});
