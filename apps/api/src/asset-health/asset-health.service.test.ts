import { describe, it } from "vitest";

import {
  assertComputedAtIsNewestRowInstantOrNull,
  assertEmptyScopeNeverTouchesTheCounterRelation,
  assertEveryAssetInScopeIsScoredEvenWithNoCounterRows,
  assertMalformedHealthYieldsNullBandNotThrow,
  assertRuleTalliesUseMaxNotSum,
  assertUnruledCatalogPointAppearsInUnscoredTags,
} from "./asset-health.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("asset-health.service", () => {
  it("aggregates the rule tallies with max(), not sum()", async () => {
    await assertRuleTalliesUseMaxNotSum();
  });

  it("never touches the counter relation when the scope is empty", async () => {
    await assertEmptyScopeNeverTouchesTheCounterRelation();
  });

  it("scores every asset in scope, even one with no counter rows at all", async () => {
    await assertEveryAssetInScopeIsScoredEvenWithNoCounterRows();
  });

  it("reports an unruled catalog point in unscoredTags rather than dropping it", async () => {
    await assertUnruledCatalogPointAppearsInUnscoredTags();
  });

  it("yields band: null on a malformed stored health block instead of throwing", async () => {
    await assertMalformedHealthYieldsNullBandNotThrow();
  });

  it("reports computedAt as the newest row instant, or null when none were read", async () => {
    await assertComputedAtIsNewestRowInstantOrNull();
  });
});
