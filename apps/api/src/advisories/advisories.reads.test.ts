import { describe, it } from "vitest";

import {
  aRowBecomesACandidateOnlyWithItsOwnZoneAndEnergyNotOff,
  theAssetFilterIsChosenByIdsBeingNull,
  theCandidateStatementHoldsTheRealLineAndAnActiveKwPoint,
  thePairReadBindsTheIdsAndPivotsByHour,
  theRankingReadBindsTheIdsAndTheLimit,
} from "./advisories.reads.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.6a — the advisory reads (ADR 0137)", () => {
  it("the candidate statement holds the ML real line, an active kw point and the label joins", () =>
    theCandidateStatementHoldsTheRealLineAndAnActiveKwPoint());
  it("the asset filter is chosen by ids === null, and the ids are one bound array", () =>
    theAssetFilterIsChosenByIdsBeingNull());
  it("the ranking read binds = ANY($1::uuid[]), the since and the limit; no ids, no read", () =>
    theRankingReadBindsTheIdsAndTheLimit());
  it("the pair read binds = ANY($1::uuid[]) and pivots kw, kva and pf by hour", () => thePairReadBindsTheIdsAndPivotsByHour());
  it("a row is a candidate only with its own valid zone and energy features not off", () =>
    aRowBecomesACandidateOnlyWithItsOwnZoneAndEnergyNotOff());
});
