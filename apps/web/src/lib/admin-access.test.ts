import { describe, it } from "vitest";

import { runAdminAccessTests, runAssetTemplateTabTests } from "./admin-access.spec";

/** Vitest entry point — see `apps/api/src/admin/admin.schema.test.ts` (ADR 0014). */
describe("admin-access", () => {
  it("gates admin routes by role", () => {
    runAdminAccessTests();
  });

  it("shows the Asset Templates tab to every master-data role", () => {
    runAssetTemplateTabTests();
  });
});
