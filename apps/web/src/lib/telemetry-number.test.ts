import { describe, it } from "vitest";

import { aDoublesTailIsDropped, aFloat32TailIsDropped, realDigitsStay } from "./telemetry-number.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.379 a stored value without its float tail", () => {
  it("drops a double's tail", () => {
    aDoublesTailIsDropped();
  });
  it("drops a float32 register's tail", () => {
    aFloat32TailIsDropped();
  });
  it("keeps every real digit", () => {
    realDigitsStay();
  });
});
