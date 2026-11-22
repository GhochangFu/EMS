import { describe, it } from "vitest";

import {
  assertEveryStockProfileIsValidAndCited,
  assertTheCheckAcceptsACitedProfile,
  assertTheCheckRefusesAnUncitedOrRepeatedProfile,
  assertTheElmeasureLgPlus5310PinsMatchTheManual,
  assertTheSelecMfm384PinsMatchTheManual,
} from "./stock-profiles.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — stock Modbus profiles (ADR 0141 decisions 12, 14)", () => {
  it("S1 every stock profile is a valid device profile citing document, revision and pages", () => {
    assertEveryStockProfileIsValidAndCited();
  });

  it("S2 the check accepts a cited profile", () => {
    assertTheCheckAcceptsACitedProfile();
  });

  it("S3 the check refuses a profile without pages, and a code listed twice", () => {
    assertTheCheckRefusesAnUncitedOrRepeatedProfile();
  });

  it("S4 Elmeasure LG+ 5310: three registers match the manual's table", () => {
    assertTheElmeasureLgPlus5310PinsMatchTheManual();
  });

  it("S5 Selec MFM384-C-CE: three registers match the manual's table", () => {
    assertTheSelecMfm384PinsMatchTheManual();
  });
});
