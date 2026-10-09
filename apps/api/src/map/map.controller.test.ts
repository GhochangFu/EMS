import { describe, it } from "vitest";

import {
  aGlobalCallerSendsNoScope,
  aMalformedParentLocationIdIs400,
  anUnknownQueryKeyIs400,
  aScopedCallerSendsItsLocationIds,
  aValidParentLocationIdIsPassedThrough,
} from "./map.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.79 MapController scopes /map/sites by location id", () => {
  it("C1 sends a scoped caller's location ids, names and asset ids", async () => {
    await aScopedCallerSendsItsLocationIds();
  });

  it("C2 sends no scope for a global caller", async () => {
    await aGlobalCallerSendsNoScope();
  });

  it("C3 passes a valid parentLocationId through (F2.10)", async () => {
    await aValidParentLocationIdIsPassedThrough();
  });

  it("C4 answers 400 for a malformed parentLocationId", async () => {
    await aMalformedParentLocationIdIs400();
  });

  it("C5 answers 400 for an unknown query key", async () => {
    await anUnknownQueryKeyIs400();
  });
});
