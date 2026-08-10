import { describe, it } from "vitest";

import {
  assertAvgExprIsWeighted,
  assertBucketWidthsAreConsistent,
  assertHierarchyDividesEvenly,
  assertRelationsAreQualifiedAndDistinct,
  assertUnknownLevelResolvesToNothing,
} from "./point-aggregates.spec";

/** `F4.1` — Vitest wrapper for the pure ADR 0023 helper assertions (ADR 0014). */
describe("F4.1 — point aggregate read helper", () => {
  it("maps every level to a distinct qualified relation", () => {
    assertRelationsAreQualifiedAndDistinct();
  });

  it("does not resolve an unknown level to a real relation", () => {
    assertUnknownLevelResolvesToNothing();
  });

  it("expresses the mean as a weighted division, never avg-of-avg", () => {
    assertAvgExprIsWeighted();
  });

  it("keeps bucket widths consistent with the raw implementation it replaced", () => {
    assertBucketWidthsAreConsistent();
  });

  it("keeps each level a whole multiple of the one below", () => {
    assertHierarchyDividesEvenly();
  });
});
