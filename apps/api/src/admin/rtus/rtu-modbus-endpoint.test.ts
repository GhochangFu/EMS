import { describe, it } from "vitest";

import { assertNoEndpointTakesNoLock, assertTheLocksAreDistinctAndSorted } from "./rtu-modbus-endpoint.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 PR 11 — the shared Modbus endpoint lock (ADR 0141 Amendment 2 (a))", () => {
  it("EL1 locks each endpoint once, in sorted order", () => assertTheLocksAreDistinctAndSorted());
  it("EL2 takes no lock for no endpoint", () => assertNoEndpointTakesNoLock());
});
