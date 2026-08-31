import { describe, it } from "vitest";

import {
  assertEachCutPointIsAnInclusiveLowerBound,
  assertEveryScoreLandsInABand,
  assertTheSameScoresAreUnbandedWithoutTheSeededBlock,
  assertTheSeededContentPassesTheApisOwnSchema,
} from "./seeded-health-baseline.spec";

describe("F4.75 — the seeded health baseline", () => {
  it("passes the schema create, update and publish would run on it", () => {
    assertTheSeededContentPassesTheApisOwnSchema();
  });

  it("puts every score in 0..1 into a band", () => {
    assertEveryScoreLandsInABand();
  });

  it("treats each cut-point as an inclusive lower bound", () => {
    assertEachCutPointIsAnInclusiveLowerBound();
  });

  it("leaves the same scores unbanded when the seeded block is absent", () => {
    assertTheSameScoresAreUnbandedWithoutTheSeededBlock();
  });
});
