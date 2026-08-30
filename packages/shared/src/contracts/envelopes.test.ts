import { describe, it } from "vitest";

import {
  runPointAggregateBucketSecondsTests,
  runPointAggregateEmptyWindowTests,
  runPointAggregateIsNotStrictTests,
  runPointAggregateResponseShapeTests,
} from "./envelopes.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.35 Stage A — the point-aggregate response contract", () => {
  it("carries the tile's half and the chart's half without requiring either", () => {
    runPointAggregateResponseShapeTests();
  });

  it("treats a window with no samples as an answer, not a failure", () => {
    runPointAggregateEmptyWindowTests();
  });

  it("stays permissive, as every response contract in this directory is", () => {
    runPointAggregateIsNotStrictTests();
  });

  it("bounds the bucket width it reports in place of a level", () => {
    runPointAggregateBucketSecondsTests();
  });
});
