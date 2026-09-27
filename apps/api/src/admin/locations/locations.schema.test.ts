import { describe, it } from "vitest";

import {
  createAdmitsNullProvince,
  createAdmitsPumpStationType,
  updateAdmitsNullCapital,
} from "./locations.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E4.1b C1 — location body schemas admit null for province and capital", () => {
  it("updateLocationBodySchema admits capital: null", () => {
    updateAdmitsNullCapital();
  });

  it("createLocationBodySchema admits province: null", () => {
    createAdmitsNullProvince();
  });
});

describe("F4.157 — createLocationBodySchema.type widens off the closed enum (ADR 0077 D1)", () => {
  it("C5 — admits type: pump_station", () => {
    createAdmitsPumpStationType();
  });
});
