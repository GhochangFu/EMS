import { describe, it } from "vitest";

import { aFlowingRowIsNormal, aShutRowIsOpenWithTheTripCause } from "./breaker-site-rows.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.80 — breakerSiteRows over the flow tones (ADR 0101 d10, d11)", () => {
  it("a flowing row is normal", () => {
    aFlowingRowIsNormal();
  });

  it("a shut row is open and shows the trip cause cell", () => {
    aShutRowIsOpenWithTheTripCause();
  });
});
