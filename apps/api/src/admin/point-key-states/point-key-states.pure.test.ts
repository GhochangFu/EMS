import { describe, it } from "vitest";

import {
  theExportIsTheSevenSeededRows,
  theSevenPairsAreSeeded,
  threeNonPairsAreNotSeeded,
} from "./point-key-states.pure.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.309 — the seeded state-label pairs (ADR 0088 Amendment 3 decision 3)", () => {
  it("reads the seven seeded rows from @bms/db", () => theExportIsTheSevenSeededRows());
  it("answers true for each of the seven pairs", () => theSevenPairsAreSeeded());
  it("answers false for three pairs that are not seeded", () => threeNonPairsAreNotSeeded());
});
