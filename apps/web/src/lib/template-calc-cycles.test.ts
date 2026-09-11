import { describe, it } from "vitest";

import {
  runMeasuredSiblingTests,
  runSelfAggregateTests,
  runSelfReferenceTests,
  runTwoPointCycleTests,
  runV1PairIsTheLintersTests,
} from "./template-calc-cycles.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template calc cycles — the within-template mirror of the server's cycle refusal", () => {
  it("reports a two-point bms-calc-v2 cycle at both points, naming both", () => {
    runTwoPointCycleTests();
  });

  it("treats a site sum over the point's own key as a one-edge cycle, and @domain/@group as nothing", () => {
    runSelfAggregateTests();
  });

  it("reports nothing for a v2 point reading a measured sibling, or for a chain", () => {
    runMeasuredSiblingTests();
  });

  it("reports a v2 self-reference — the case no client check caught before", () => {
    runSelfReferenceTests();
  });

  it("leaves a v1 pair to the derived-reference refusal", () => {
    runV1PairIsTheLintersTests();
  });
});
