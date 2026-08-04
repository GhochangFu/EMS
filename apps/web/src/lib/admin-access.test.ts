import { describe, it } from "vitest";

import { runAdminAccessTests } from "./admin-access.spec";

/** Vitest entry point — see `apps/api/src/admin/admin.schema.test.ts` (ADR 0014). */
describe("admin-access", () => {
  it("gates admin routes by role", () => {
    runAdminAccessTests();
  });
});
