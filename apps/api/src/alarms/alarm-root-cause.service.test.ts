import { describe, it } from "vitest";

import {
  aDeviceAlarmReadsNoEvidence,
  aMismatchedAssetGivesTheEmptyAnswer,
  everyEvidenceReadRunsInOneTenantTransaction,
  r4RunsOnlyWithARuleAndTheAncestorWalkAlways,
  theGateRunsFirstWithTheCallersIds,
  theRelatedReadCapsByClassAndDropsReRaises,
  theRelatedReadCarriesTheCallersScope,
  theRowsReachTheRankingSplitBySource,
  theWindowsReadDropsCancelledWindowsAndForeignLocations,
} from "./alarm-root-cause.service.spec";

/** `E2.3` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("E2.3 — AlarmRootCauseService (stub gate, recording tenant handle)", () => {
  it("the details gate runs first with the caller's ids; its 404 reads no evidence", () =>
    theGateRunsFirstWithTheCallersIds());
  it("Q4: a device alarm answers the empty lists and opens no transaction", () => aDeviceAlarmReadsNoEvidence());
  it("Q2: every evidence read runs in one withTenant transaction of the alarm's organization", () =>
    everyEvidenceReadRunsInOneTenantTransaction());
  it("R4 runs only with a rule; the ancestor walk runs every time, before R1", () =>
    r4RunsOnlyWithARuleAndTheAncestorWalkAlways());
  it("a scoped caller's asset ids reach the related read inside the capped subquery; the admin's has no guard", () =>
    theRelatedReadCarriesTheCallersScope());
  it("R1 drops a window cancelled before it started and reads only the subject's ancestor location targets", () =>
    theWindowsReadDropsCancelledWindowsAndForeignLocations());
  it("R2/R3/R3b are capped per class and the subject's re-raises are dropped before the cap", () =>
    theRelatedReadCapsByClassAndDropsReRaises());
  it("an alarm whose asset is outside its organization gives the empty answer", () =>
    aMismatchedAssetGivesTheEmptyAnswer());
  it("rows reach the ranking split by source; anomaly rows reach only the context", () =>
    theRowsReachTheRankingSplitBySource());
});
