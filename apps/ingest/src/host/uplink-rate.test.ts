import { describe, it } from "vitest";

import {
  aFullBucketAdmitsOneSecondThenRefuses,
  aRefusalTakesNothing,
  bucketsArePerGateway,
  theBucketCapsAtOneSecond,
} from "./uplink-rate.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — per-gateway uplink sample rate (security review M2)", () => {
  it("admits one second's worth and then refuses with a Retry-After", () => {
    aFullBucketAdmitsOneSecondThenRefuses();
  });

  it("takes nothing for a refused batch", () => {
    aRefusalTakesNothing();
  });

  it("keeps one bucket per gateway", () => {
    bucketsArePerGateway();
  });

  it("caps the bucket at one second", () => {
    theBucketCapsAtOneSecond();
  });
});
