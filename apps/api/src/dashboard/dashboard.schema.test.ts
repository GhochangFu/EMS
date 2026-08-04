import { describe, it } from "vitest";

import { runDashboardSchemaTests } from "./dashboard.schema.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("dashboard.schema", () => {
  it("accepts and rejects dashboard query payloads", () => {
    runDashboardSchemaTests();
  });
});
