import { describe, it } from "vitest";

import {
  assertACoverageRatioOnlyChangeIsReported,
  assertDerivedChangesAreReportedNeverRefused,
  assertDifferentRowIdentitiesWithSameKeysAreNoChange,
  assertIdenticalVersionsProduceAnEmptyDelta,
  assertKindFlipsAreClassifiedExplicitly,
  assertMeasuredAdditionDoesNotRefuse,
  assertMeasuredReKeyRefuses,
  assertMeasuredRemovalRefuses,
} from "./template-version-delta.spec";

/** `F2.6` U5 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.6 — template version delta", () => {
  it("reports nothing and refuses nothing when the versions are identical", () => {
    assertIdenticalVersionsProduceAnEmptyDelta();
  });

  it("keys on point_key, so different row identities with the same keys are no change (D-4)", () => {
    assertDifferentRowIdentitiesWithSameKeysAreNoChange();
  });

  it("refuses a measured removal, naming the point key", () => {
    assertMeasuredRemovalRefuses();
  });

  it("refuses a measured re-key, naming both patterns", () => {
    assertMeasuredReKeyRefuses();
  });

  it("reports a measured addition without refusing", () => {
    assertMeasuredAdditionDoesNotRefuse();
  });

  it("reports derived additions, removals and per-field changes, and never refuses them", () => {
    assertDerivedChangesAreReportedNeverRefused();
  });

  it("reports a min_coverage_ratio-only change, both directions (F2.9 finding 31)", () => {
    assertACoverageRatioOnlyChangeIsReported();
  });

  it("classifies a kind flip explicitly in both directions", () => {
    assertKindFlipsAreClassifiedExplicitly();
  });
});
