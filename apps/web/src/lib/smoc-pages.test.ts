import { describe, it } from "vitest";

import {
  runP1,
  runP2,
  runP3,
  runP4,
  runP5,
  runP6,
  runP7,
  runP8,
  runP9,
  runP9b,
  runP9c,
} from "./smoc-pages.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("smoc-pages", () => {
  it("P1 — the seven tabs, in order, each with its area", () => {
    runP1();
  });

  it("P2 — smocTabPath builds the :tab URL, encoding the locationId", () => {
    runP2();
  });

  it("P3 — an undefined tab param resolves to the overview tab", () => {
    runP3();
  });

  it("P4 — an unknown tab param resolves to null", () => {
    runP4();
  });

  it("P5 — a known tab param resolves to itself", () => {
    runP5();
  });

  it("P6 — HVAC_ONLY allows overview and hvac", () => {
    runP6();
  });

  it("P7 — ELECTRICAL_ONLY allows ups and battery, not hvac", () => {
    runP7();
  });

  it("P8 — GLOBAL allows all seven tabs", () => {
    runP8();
  });

  it("P9 — findSmocSite picks the RSMOC-WC row, not the first", () => {
    runP9();
  });

  it("P9b — findSmocSite skips an RSMOC-WC row of another organization", () => {
    runP9b();
  });

  it("P9c — isSmocSite is false for RSMOC-WC in PHEWB", () => {
    runP9c();
  });
});
