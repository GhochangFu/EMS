import { describe, it } from "vitest";

import {
  runBrokenFormulaRefTests,
  runBrokenFormulaRefsReadTheRowsDialectTests,
  runCalcFieldsSurviveARoundTripTests,
  runChangeDetectionTests,
  runEmptyOverridesBecomeNullTests,
  runGridErrorTests,
  runIncompleteDerivedPointTests,
  runKindChangeTests,
  runMinCoverageRatioSurvivesARoundTripTests,
  runPointMetaSurvivesARoundTripTests,
  runSeedTests,
  runTierAuthoringTests,
} from "./template-points-grid.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template points grid", () => {
  it("carries every calc field through a load-and-save round trip", () => {
    runCalcFieldsSurviveARoundTripTests();
  });

  it("carries meta.tier through a load-and-save round trip, omitting the key for an untiered point (F2.13)", () => {
    runPointMetaSurvivesARoundTripTests();
  });

  it("carries minCoverageRatio through a round trip and clears it on derived → measured (F2.9)", () => {
    runMinCoverageRatioSurvivesARoundTripTests();
  });

  it("reads each row's formula under its own dialect", () => {
    runBrokenFormulaRefsReadTheRowsDialectTests();
  });

  it("seeds rows from the template and appends after the highest sortOrder", () => {
    runSeedTests();
  });

  it("sends null for an emptied override, never an empty string", () => {
    runEmptyOverridesBecomeNullTests();
  });

  it("clears the calc fields when a point stops being derived, and seeds none when it starts", () => {
    runKindChangeTests();
  });

  it("catches duplicate keys, blank keys and the 500-point cap before the server does", () => {
    runGridErrorTests();
  });

  it("refuses a derived point this tab cannot finish, and says where to finish it", () => {
    runIncompleteDerivedPointTests();
  });

  it("names the formula an edit to another row just broke", () => {
    runBrokenFormulaRefTests();
  });

  it("treats a change as what would be sent, not what was typed", () => {
    runChangeDetectionTests();
  });

  it("makes the tier authorable: a tier-only edit is a change, and no rule branches on it (F2.15)", () => {
    runTierAuthoringTests();
  });
});
