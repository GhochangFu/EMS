import { describe, it } from "vitest";

import {
  runAnUnknownValueIsRefused,
  runTheDashboardDtoCarriesTheKeys,
  runTheListsInOrder,
  runTheNullableFigures,
  runTheRowRequiresTheNewKeys,
} from "./energy-features.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.364 — organization energy features and the location row (ADR 0133)", () => {
  it("E1 — the three lists, auto first", () => {
    runTheListsInOrder();
  });

  it("E2 — an unknown value is refused; auto is never resolved", () => {
    runAnUnknownValueIsRefused();
  });

  it("E3 — the row requires energyShown, primaryMetric, healthScore and totalKw", () => {
    runTheRowRequiresTheNewKeys();
  });

  it("E4 — totalKw and healthScore are number | null", () => {
    runTheNullableFigures();
  });

  it("E5 — the dashboard DTO stays an intersection and carries the keys", () => {
    runTheDashboardDtoCarriesTheKeys();
  });
});
