import { describe, it } from "vitest";

import {
  assertAvgExprIsWeighted,
  assertBucketWidthsAreConsistent,
  assertCoarseLevelsHaveNoHorizon,
  assertGranularityIsHonouredWhenRetained,
  assertHierarchyDividesEvenly,
  assertLevelIgnoresTheRangeEnd,
  assertRelationsAreQualifiedAndDistinct,
  assertRetentionBoundaryIsInclusive,
  assertRetentionGuardEscalatesPastTheHorizon,
  assertUnknownGranularityThrows,
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

/**
 * `F4.28` / ADR 0025 decision 1 — the retention-aware level selector.
 *
 * Separate `describe` because these are not ADR 0023's assertions: they exist
 * because `F4.28` introduces the selector ADR 0024 withdrew, and a duration-keyed
 * one would route an old report to a level whose data has been dropped — 0 rows,
 * silently, unrebuildable.
 */
describe("F4.28 — retention-aware level selection", () => {
  it("escalates to a level that still retains the range", () => {
    assertRetentionGuardEscalatesPastTheHorizon();
  });

  it("treats the 735-day horizon as inclusive", () => {
    assertRetentionBoundaryIsInclusive();
  });

  it("decides from start and now only, never from the range end", () => {
    assertLevelIgnoresTheRangeEnd();
  });

  it("honours the requested granularity whenever retention allows", () => {
    assertGranularityIsHonouredWhenRetained();
  });

  it("keeps _1h and _1d free of any retention horizon", () => {
    assertCoarseLevelsHaveNoHorizon();
  });

  it("throws on an unknown granularity rather than defaulting", () => {
    assertUnknownGranularityThrows();
  });
});
