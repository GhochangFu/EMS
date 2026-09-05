import { describe, it } from "vitest";

import {
  assertACandidateOffEveryCycleReportsNothing,
  assertTheCandidateReplacesItsOwnStoredNode,
  assertTheDetectorsReadDoesNotCountSkips,
} from "./calc-dependency.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.9 — CalcDependencyService, the save-time cycle detector", () => {
  it("resolves without counting a skip, and still sees the stored definitions", async () => {
    await assertTheDetectorsReadDoesNotCountSkips();
  });

  it("replaces the stored definition for the candidate's own key", async () => {
    await assertTheCandidateReplacesItsOwnStoredNode();
  });

  it("reports nothing for a candidate that only reads a cycle", async () => {
    await assertACandidateOffEveryCycleReportsNothing();
  });
});
