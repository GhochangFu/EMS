import { describe, it } from "vitest";

import { createAdmitsNullProvince, updateAdmitsNullCapital } from "./locations.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E4.1b C1 — location body schemas admit null for province and capital", () => {
  it("updateLocationBodySchema admits capital: null", () => {
    updateAdmitsNullCapital();
  });

  it("createLocationBodySchema admits province: null", () => {
    createAdmitsNullProvince();
  });
});
