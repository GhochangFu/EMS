import { describe, it } from "vitest";

import { aGlobalCallerSendsNoScope, aScopedCallerSendsItsLocationIds } from "./map.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.79 MapController scopes /map/sites by location id", () => {
  it("C1 sends a scoped caller's location ids, names and asset ids", async () => {
    await aScopedCallerSendsItsLocationIds();
  });

  it("C2 sends no scope for a global caller", async () => {
    await aGlobalCallerSendsNoScope();
  });
});
