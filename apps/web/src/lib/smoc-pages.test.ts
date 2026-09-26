import { describe, it } from "vitest";

import {
  runP1,
  runP2,
  runP3,
  runP4,
  runP5,
  runP6a,
  runP6b,
  runP6c,
  runP7a,
  runP7b,
  runP7c,
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

  it("P6a — HVAC_ONLY allows exactly two tabs", () => {
    runP6a();
  });

  it("P6b — HVAC_ONLY allows overview", () => {
    runP6b();
  });

  it("P6c — HVAC_ONLY allows hvac", () => {
    runP6c();
  });

  it("P7a — ELECTRICAL_ONLY allows ups", () => {
    runP7a();
  });

  it("P7b — ELECTRICAL_ONLY allows battery", () => {
    runP7b();
  });

  it("P7c — ELECTRICAL_ONLY does not allow hvac", () => {
    runP7c();
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
