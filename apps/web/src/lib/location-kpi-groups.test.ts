import { describe, it } from "vitest";

import { runK1, runK2 } from "./location-kpi-groups.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("location-kpi-groups", () => {
  it("K1 — freshLocationCount counts only sites with fresh telemetry", () => {
    runK1();
  });

  it("K2 — organizations sort by code, sites sort by name", () => {
    runK2();
  });
});
