import { describe, it } from "vitest";

import {
  aDeviceAlarmReadsNoEvidence,
  aMismatchedAssetGivesTheEmptyAnswer,
  everyEvidenceReadRunsInOneTenantTransaction,
  r4AndTheAncestorWalkRunOnlyWhenNeeded,
  theGateRunsFirstWithTheCallersIds,
  theRowsReachTheRankingSplitBySource,
} from "./alarm-root-cause.service.spec";

/** `E2.3` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("E2.3 — AlarmRootCauseService (stub gate, recording tenant handle)", () => {
  it("the details gate runs first with the caller's ids; its 404 reads no evidence", () =>
    theGateRunsFirstWithTheCallersIds());
  it("Q4: a device alarm answers the empty lists and opens no transaction", () => aDeviceAlarmReadsNoEvidence());
  it("Q2: every evidence read runs in one withTenant transaction of the alarm's organization", () =>
    everyEvidenceReadRunsInOneTenantTransaction());
  it("R4 runs only with a rule; the ancestor walk only with a location target", () =>
    r4AndTheAncestorWalkRunOnlyWhenNeeded());
  it("an alarm whose asset is outside its organization gives the empty answer", () =>
    aMismatchedAssetGivesTheEmptyAnswer());
  it("rows reach the ranking split by source; anomaly rows reach only the context", () =>
    theRowsReachTheRankingSplitBySource());
});
