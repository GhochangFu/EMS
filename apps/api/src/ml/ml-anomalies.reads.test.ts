import { describe, it } from "vitest";

import {
  everyListColumnIsAliased,
  theAssetStatementHoldsTheJoinTheWindowAndTheNewestRun,
  theListFiltersByAssetWheneverIdsAreGiven,
  theListPicksTheNewestRunBeforeTheThreshold,
} from "./ml-anomalies.reads.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.2b — the anomaly statements' text (ADR 0135 Amendment 5 A-e)", () => {
  it("the one-asset read: the succeeded join, the asset and window bound, the newest run per hour and detector", () =>
    theAssetStatementHoldsTheJoinTheWindowAndTheNewestRun());
  it("S1: the list carries asset_id = ANY whenever ids is not null, an empty list included", () =>
    theListFiltersByAssetWheneverIdsAreGiven());
  it("R12/R13: succeeded anomaly runs since the bound, newest run first, then the threshold, newest first, cap + 1", () =>
    theListPicksTheNewestRunBeforeTheThreshold());
  it("every output column of the list is aliased", () => everyListColumnIsAliased());
});
