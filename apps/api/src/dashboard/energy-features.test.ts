import { describe, it } from "vitest";

import {
  runAnUnknownValueActsAsAuto,
  runTheCardSettingTable,
  runTheEnergySettingTable,
  runTheTotalKw,
  runTheWindowIsThirtyDays,
} from "./energy-features.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.364 — resolveLocationEnergy (ADR 0133 decisions 2–4)", () => {
  it("R1 — the energy-data window is 30 days", () => {
    runTheWindowIsThirtyDays();
  });

  it("R2 — on / off / auto × energy data", () => {
    runTheEnergySettingTable();
  });

  it("R3 — the five card settings × energy shown (Q5: kw is honoured)", () => {
    runTheCardSettingTable();
  });

  it("R4 — totalKw is null when hidden or when no asset has a kw value", () => {
    runTheTotalKw();
  });

  it("R5 — an unknown stored value acts as auto", () => {
    runAnUnknownValueActsAsAuto();
  });
});
